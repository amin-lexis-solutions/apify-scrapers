import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import {
  getDomainName,
  processAndStoreData,
  generateHash,
} from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';
import { Label } from 'shared/actor-utils';

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
