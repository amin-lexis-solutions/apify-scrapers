import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  checkExistingCouponsAnomaly,
  processAndStoreData,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

export const router = createCheerioRouter();

function cleanContent(element) {
  const formatElement = he
    .decode(element.text())
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace('\n\n', '\n');
  return formatElement;
}

async function processCouponItem(
  merchantName: string,
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

  let voucherTitle;
  const titleElement = $coupon('h3.voucher__heading').first();

  if (titleElement) {
    voucherTitle = cleanContent(titleElement);
  }
  const elemCode = $coupon('.voucher__btn').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  const idInSite = $coupon('.voucher__btn ').first().attr('data-id');

  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-promotion-id attr is missing');
  }

  // Description
  let description;
  const descElement = $coupon('.text-expand__text').first();
  if (descElement) {
    description = descElement.attr('data-load');
  }

  const validator = new DataValidator();
  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  let code;
  if (hasCode) {
    const voucherCodeElement = $coupon('.voucher-button__code');
    code = voucherCodeElement.text();
    validator.addValue('code', code);
  }
  await processAndStoreData(validator);
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  function getMerchantName() {
    // Select the merchant logo element
    const $merchantLogo = $('.store__logo img');

    // Check if the merchant logo element exists
    if ($merchantLogo.length === 0) {
      return null; // No merchant name found
    }

    // Extract merchant name from the alt attribute
    const altText = $merchantLogo.attr('alt');
    const merchantName = altText?.split('rabattkod')[0]?.trim() ?? null;

    return merchantName;
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    const merchantName = getMerchantName();

    if (!merchantName) {
      throw new Error('Unable to find merchant name element');
    }

    const validCoupons = $('.voucher__list > div.voucher');

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    // Extract valid coupons
    for (let index = 0; index < validCoupons.length; index++) {
      const element = validCoupons[index];
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
