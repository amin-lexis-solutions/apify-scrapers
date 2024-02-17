import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData } from 'shared/helpers';

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
  merchantName: string,
  domain: string,
  couponElement: cheerio.Element,
  sourceUrl: string,
  index: number
) {
  const $coupon = cheerio.load(couponElement);

  const idInSite = $coupon('*').first().attr('data-promotion-id');
  if (!idInSite) {
    console.log(
      `Element data-promotion-id attr is missing in ${sourceUrl} , item #${index}`
    );
    return false;
  }

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
    const coupon = elemCode.text().trim();
    validator.addValue('code', coupon);
  }
  await processAndStoreData(validator);
  return true;
}

export const router = createCheerioRouter();

router.addHandler(Label.sitemap, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.sitemap) return;

  const sitemapLinks = $('dd.merchant-list-item__merchant > a');
  if (sitemapLinks.length === 0) {
    console.log('Sitemap HTML:', $.html());
    throw new Error('Sitemap links are missing');
  }

  // Map each link to a full URL
  const sitemapUrls = sitemapLinks
    .map((i, el) => {
      const sitemapUrl = $(el).attr('href');

      // Skip if the href attribute is missing
      if (typeof sitemapUrl === 'undefined') {
        throw new Error('Sitemap link is missing the href attribute');
      }

      return sitemapUrl;
    })
    .get();

  console.log(`Found ${sitemapUrls.length} URLs in the sitemap`);

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
        merchantName,
        domain,
        element,
        request.url,
        i + 1
      );
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});
