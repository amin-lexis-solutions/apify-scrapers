import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import {
  getDomainName,
  processAndStoreData,
  generateHash,
} from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';

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
  domain: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let titleCss = '';
  let codeCss = '';
  let codeAttr = '';
  if (!isExpired) {
    titleCss = 'h3';
    codeCss = 'span[data-masked]';
    codeAttr = 'data-masked';
  } else {
    titleCss = 'p';
    codeCss = 'button[title]';
    codeAttr = 'title';
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

  const idInSite = generateHash(merchantName, voucherTitle, sourceUrl);

  // Extract the voucher code
  const codeElement = $coupon(codeCss).first();
  let code = '';
  if (codeElement.length !== 0) {
    code = codeElement.attr(codeAttr) || '';
    if (!code) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Voucher code is missing');
    }
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
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

  const sitemapLinks = $('div[id^=store-] span > a');
  if (sitemapLinks.length === 0) {
    console.log('Sitemap HTML:', $.html());
    throw new Error('Sitemap links are missing');
  }
  // Base URL from the request
  const baseUrl = new URL(request.url);

  // Map each link to a full URL
  const sitemapUrls = sitemapLinks
    .map((i, el) => {
      const relativePath = $(el).attr('href');

      // Skip if the href attribute is missing
      if (typeof relativePath === 'undefined') {
        throw new Error('Sitemap link is missing the href attribute');
      }

      return new URL(relativePath, baseUrl).href;
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

    // Extract JSON data from the script tag
    const scriptContent = $('#schema-data-store').html();
    if (!scriptContent) {
      console.log('Not a valid merchant page - schema data missing');
    } else {
      // Parse the JSON data
      const jsonData = JSON.parse(scriptContent);
      const merchantName = jsonData.name;
      const domain = getDomainName(jsonData.url);

      // Check if valid page
      if (!merchantName) {
        console.log(`Not Merchant URL: ${request.url}`);
      } else {
        // console.log(`Merchant Name: ${merchantName}`);
        // console.log('Domain:', domain);
        // Extract valid coupons
        const validCoupons = $('ul.sc-a8fe2b69-0 > li > div');
        for (let i = 0; i < validCoupons.length; i++) {
          const element = validCoupons[i];
          await processCouponItem(
            merchantName,
            domain,
            false,
            element,
            request.url
          );
        }
        const expiredCoupons = $('div.sc-e58a3b10-5 > div');
        for (let i = 0; i < expiredCoupons.length; i++) {
          const element = expiredCoupons[i];
          await processCouponItem(
            merchantName,
            domain,
            true,
            element,
            request.url
          );
        }
      }
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});
