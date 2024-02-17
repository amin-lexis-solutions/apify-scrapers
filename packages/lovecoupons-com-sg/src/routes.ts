import cheerio from 'cheerio';
import { RequestProvider } from 'crawlee';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, sleep, getDomainName } from 'shared/helpers';

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'getCode' = 'GetCodePage',
}

const CUSTOM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/117.0',
};

function extractAllText(elem: cheerio.Cheerio): string {
  let text = '';
  if (elem.length > 0) {
    text = he
      .decode(elem.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  return text.trim();
}

async function processCouponItem(
  requestQueue: RequestProvider,
  merchantName: string,
  domain: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  const attrDataType = $coupon('*').first().attr('data-type');
  if (!attrDataType) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Attr data-type is missing');
  }

  let hasCode = false;
  if (attrDataType === '2') {
    hasCode = true;
  }

  const attrDataId = $coupon('*').first().attr('data-id');
  if (!attrDataId) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Attr data-id is missing');
  }

  const idInSite = attrDataId.trim();

  let couponUrl = '';
  if (hasCode) {
    const attrDataOut = $coupon('*').first().attr('data-out');
    if (!attrDataOut) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Attr data-out is missing');
    }
    couponUrl = new URL(attrDataOut.trim(), sourceUrl).href.replace(
      '/go/2/',
      '/go/3/'
    );
  }

  // Extract the voucher title
  const titleElement = $coupon('article header > h2').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = extractAllText(titleElement);

  if (!voucherTitle) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is empty');
  }

  // Extract the description
  const descrElement = $coupon('article header > p').first();
  const description = extractAllText(descrElement);

  // Extract terms and conditions
  const tocElement = $coupon('div.TermsConditions').first();
  const toc = extractAllText(tocElement);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('termsAndConditions', toc);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (hasCode) {
    // Add the coupon URL to the request queue
    await requestQueue.addRequest(
      {
        url: couponUrl,
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
  let sitemapUrls = sitemapLinks.map((i, el) => $(el).text().trim()).get();

  console.log(`Found ${sitemapUrls.length} URLs in the sitemap`);

  // Define a list of banned URL patterns (regular expressions)
  const bannedPatterns: RegExp[] = [/\/brands$/, /\/brands\/[0a-z]$/];

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

    const merchantLI = $('ul.c-breadcrumbs > li:last-child');

    const merchantName = he.decode(merchantLI ? merchantLI.text().trim() : '');

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }
    // console.log(`Merchant Name: ${merchantName}`);

    const domainSpan = $('p.BrandUrl > span');

    const domainUrl = he.decode(domainSpan ? domainSpan.text().trim() : '');

    if (!domainUrl) {
      throw new Error('Merchant name is missing');
    }

    const domain = getDomainName(domainUrl);
    // console.log(`Merchant Domain: ${domain}`);

    // Extract valid coupons
    const validCoupons = $('div.BrandOffers > article');
    for (let i = 0; i < validCoupons.length; i++) {
      const element = validCoupons[i];
      await processCouponItem(
        crawler.requestQueue,
        merchantName,
        domain,
        false,
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
    const codeDiv = $('div#CodeCoupon');
    if (codeDiv.length === 0) {
      // console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code div is missing');
    }

    const code = codeDiv.text().trim();

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
