import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  // Retrieve 'data-id' attribute
  const dataId = $coupon.root().children().first().attr('data-id');

  // Check if 'data-id' is set and not empty
  if (!dataId || dataId.trim() === '') {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Missing or empty data-id attribute');
  }

  // Extract the voucher title
  const titleElement = $coupon('div.coupon-info > div.item-title > h3');
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  const descElement = $coupon(
    'div.coupon-info > div.coupon-info-complement > div.item-desc-wrapper > div.item-desc'
  );
  const description = descElement.length > 0 ? descElement.text().trim() : '';

  // Extract the code
  let code = '';
  const codeElement = isExpired
    ? $coupon('div.coupon-info > div.item-title > span.coupon-code > span.code')
    : $coupon('button.item-code > span.item-promo-block > span.item-code-link');

  if (codeElement.length > 0) {
    code = codeElement.text().trim();
  }

  // Determine if the coupon isExclusive
  const exclusiveElement = $coupon(
    'div.coupon-info > div.coupon-info-complement > div.couponStatus > span.couponStatus-item'
  );
  const exclusiveText =
    exclusiveElement.length > 0 ? exclusiveElement.text().toUpperCase() : '';
  const isExclusive = exclusiveText.includes('EXCLUSIVO');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', dataId);
  validator.addValue('description', description);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isExpired', isExpired);
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

    const merchantName = $('div.storeHeader').attr('data-store-name');
    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }

    // Refactor to use a loop for valid coupons
    const validCoupons = $('ul.coupon-list.valid-coupons > li[data-id]');
    for (let i = 0; i < validCoupons.length; i++) {
      const element = validCoupons[i];
      await processCouponItem(merchantName, false, element, request.url);
    }

    // Refactor to use a loop for expired coupons
    const expiredCoupons = $('ul.coupon-list.expired-coupons > li[data-id]');
    for (let i = 0; i < expiredCoupons.length; i++) {
      const element = expiredCoupons[i];
      await processCouponItem(merchantName, true, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
