import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  // Extract the voucher title
  const titleElement = $coupon('h2');
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the voucher id
  const dataId = $coupon('input.more-hidden').attr('id');
  if (!dataId) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher id is missing');
  }

  // Extract the description
  const descElement = $coupon('p.voucher-details');
  const description = descElement.length > 0 ? descElement.text().trim() : '';

  // Extract the code
  let code = '';
  const codeElement = $coupon('span#coupon-code');

  if (codeElement.length > 0) {
    code = codeElement.text().trim();
  }

  const idInSite = dataId.trim().split('-')[1];

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);
  if (code) {
    validator.addValue('code', code);
  }

  await processAndStoreData(validator);
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async ({ request, body }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`\nProcessing URL: ${request.url}`);
    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    const merchantNameElem = $('div.breadcrumbs span.breadcrumb_last');
    if (!merchantNameElem) {
      throw new Error('Unable to find merchant name element');
    }

    const merchantName = merchantNameElem.text().trim();

    const validCoupons = $('ul#vouchers > li > div');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
