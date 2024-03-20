import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  const idInSite = $coupon('*').first().attr('data-cid');
  if (!idInSite) {
    console.log(`Element data-cid attr is missing in ${sourceUrl}`);
    return false;
  }

  const elementDataType = $coupon('*').first().attr('data-type');
  if (!elementDataType) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-type is missing');
  }

  const hasCode = elementDataType === 'cp';

  const elemCode = $coupon('span.visible-lg').first();

  if (hasCode && elemCode.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Coupon code is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon('div.gcbr > p').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the description
  let description = '';
  const descElement = $coupon('div.open').first();
  if (descElement.length > 0) {
    description = descElement.text();
    description = description
      .trim() // Remove leading and trailing whitespace
      .replace(/[ \t]+/g, ' ') // Replace multiple whitespace characters with a single space
      .replace(/\n+/g, '\n') // Replace multiple newline characters with a single newline
      .trim(); // Final trim to clean up any leading/trailing whitespace after replacements
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (hasCode) {
    const coupon = elemCode.text().trim();
    validator.addValue('code', coupon);
  }
  await processAndStoreData(validator);
  return true;
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

    const merchantLink = $('ul.g-bread > li:last-child');

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().replace('Coupons', '').trim() : ''
    );

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    // Extract valid coupons
    const validCoupons = $('div.container ul.gmc-list > li > div[data-type]');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // Do nothing
  }
});
