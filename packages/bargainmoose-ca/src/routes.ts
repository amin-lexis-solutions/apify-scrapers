import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import * as he from 'he';
import { RequestProvider } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, sleep } from 'shared/helpers';

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'getCode' = 'GetCodePage',
}

const CUSTOM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/117.0',
};

function extractDomainFromUrl(url: string): string {
  // Regular expression to extract the domain name
  const regex = /https?:\/\/[^/]+\/[^/]+\/([^/]+)/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Remove 'www.' if present
    if (matches[1].startsWith('www.')) {
      return matches[1].substring(4);
    }
    return matches[1];
  }

  return '';
}

async function processCouponItem(
  requestQueue: RequestProvider,
  merchantName: string,
  domain: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;

  let isExpired = false;

  const elementClass = $coupon('*').first().attr('class');
  if (!elementClass) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  isExpired = elementClass.includes('expired');

  const elemCode = $coupon('div span.btn-peel__secret').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  const idInSite = $coupon('*').first().attr('data-promotion-id');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-promotion-id attr is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon('h3').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the description
  let description = '';
  const descElement = $coupon(
    'div.promotion-term-extra-tab__detail-content'
  ).first();
  if (descElement.length > 0) {
    description = he
      .decode(descElement.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (hasCode) {
    // Add the coupon URL to the request queue
    await requestQueue.addRequest(
      {
        url: `https://www.bargainmoose.ca/coupons/promotions/modal/${idInSite}`,
        userData: {
          label: Label.getCode,
          validatorData: validator.getData(),
        },
        headers: CUSTOM_HEADERS,
      },
      { forefront: true }
    );
  } else {
    await processAndStoreData(validator);
  }
}

export const router = createCheerioRouter();

router.addHandler(Label.sitemap, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.sitemap) return;

  const sitemapLinks = $('urlset url loc');
  if (sitemapLinks.length === 0) {
    console.log('Sitemap HTML:', $.html());
    throw new Error('Sitemap links are missing');
  }
  let sitemapUrls = sitemapLinks
    .map((i, el) => $(el).text().trim() as string)
    .get();

  console.log(`Found ${sitemapUrls.length} URLs in the sitemap`);

  // Define a list of banned URL patterns (regular expressions)
  const bannedPatterns: RegExp[] = [/\/coupons$/, /\/coupons\/[^.]+$/];

  if (bannedPatterns.length > 0) {
    // Filter out URLs that match any of the banned patterns
    const oldLength = sitemapUrls.length;
    sitemapUrls = sitemapUrls.filter((url) => {
      const notBanned = !bannedPatterns.some((pattern) => pattern.test(url));
      return notBanned;
    });

    if (sitemapUrls.length < oldLength) {
      console.log(
        `Remained ${sitemapUrls.length} URLs after filtering banned patterns`
      );
    }
  }

  let limit = sitemapUrls.length; // Use the full length for production
  if (request.userData.testLimit) {
    // Take only the first X URLs for testing
    limit = Math.min(request.userData.testLimit, sitemapUrls.length);
  }

  const testUrls = sitemapUrls.slice(0, limit);
  if (limit < sitemapUrls.length) {
    console.log(`Using ${testUrls.length} URLs for testing`);
  }

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  // Manually add each URL to the request queue
  for (const url of testUrls) {
    await crawler.requestQueue.addRequest({
      url: url,
      userData: {
        label: Label.listing,
      },
      headers: CUSTOM_HEADERS,
    });
  }
});

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    const merchantLink = $(
      'ol.breadcrumb > li:last-child > a.breadcrumb-item__link'
    );

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }
    // console.log(`Merchant Name: ${merchantName}`);

    const domain = extractDomainFromUrl(request.url);
    if (!domain) {
      throw new Error('Domain is missing');
    }
    // console.log(`Domain: ${domain}`);

    // Extract valid coupons
    const validCoupons = $('div.promotion-list__promotions > div');
    for (let i = 0; i < validCoupons.length; i++) {
      const element = validCoupons[i];
      await processCouponItem(
        crawler.requestQueue,
        merchantName,
        domain,
        element,
        request.url
      );
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, $ } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Extract the coupon code
    const codeInput = $('input.promotion-modal__code-row__code');
    if (codeInput.length === 0) {
      console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code input is missing');
    }

    const code = codeInput.val().trim();

    // Check if the code is found
    if (!code) {
      console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code not found in the HTML content');
    }

    console.log(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await processAndStoreData(validator);
  } catch (error) {
    // Handle any errors that occurred during the handler execution
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});
