import cheerio from 'cheerio';
import * as he from 'he';
import { createCheerioRouter } from 'crawlee';
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
  Origin: 'https://www.picodi.com',
};

async function processCouponItem(
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let titleCss = '';
  let codeCss = '';
  if (!isExpired) {
    titleCss = 'div.partner-pg__offer-coupon__body';
    codeCss = 'span.partner-pg__code-button__value';
  } else {
    titleCss = 'h3';
    codeCss = 'span.partner-pg__expired-coupons-section__code';
  }

  const idInSite = $coupon('*').first().attr('data-offer-id');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-offer-id attr is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon(titleCss).first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(
    titleElement
      .text()
      .trim()
      .replace(/[\s\t\r\n]+/g, ' ')
  );

  // Extract the voucher code
  const codeElement = $coupon(codeCss).first();
  let code = '';
  if (codeElement.length !== 0) {
    code = he.decode(
      codeElement
        .text()
        .trim()
        .replace(/[\s\t\r\n]+/g, ' ')
    );
    if (!code && !isExpired) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Voucher code is missing');
    }
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (code) {
    validator.addValue('code', code);
  }

  await processAndStoreData(validator);
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

  // Define the inclusion pattern
  const includePattern = /\/desconto\//;

  // Filter in URLs that contain the pattern `/desconto/`
  const oldLength = sitemapUrls.length;
  sitemapUrls = sitemapUrls.filter((url) => includePattern.test(url));

  if (sitemapUrls.length < oldLength) {
    console.log(
      `Retained ${sitemapUrls.length} URLs after filtering for /desconto/ pattern`
    );
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

    // Extract the content of the meta tag
    const metaContent = $('meta[property="og:image:alt"]').attr('content');

    // Remove the word "Logotipo" from the extracted content
    const merchantName = metaContent
      ? metaContent.replace('Logotipo ', '')
      : '';

    // Check if valid page
    if (!merchantName) {
      console.log(`Not Merchant URL: ${request.url}`);
    } else {
      // console.log(`Merchant Name: ${merchantName}`);
      // Extract valid coupons
      const validCoupons = $(
        'div.partner-pg__coupon-list__items > div[data-offer-id]'
      );
      for (let i = 0; i < validCoupons.length; i++) {
        const element = validCoupons[i];
        await processCouponItem(merchantName, false, element, request.url);
      }
      const expiredCoupons = $(
        'ul.partner-pg__expired-coupons-section__items > li[data-offer-id]'
      );
      for (let i = 0; i < expiredCoupons.length; i++) {
        const element = expiredCoupons[i];
        await processCouponItem(merchantName, true, element, request.url);
      }
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});
