import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, getDomainName } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

function extractAndFormatDate(input: string | null): string | null {
  if (!input) return null;

  // Use a regular expression to extract the date portion of the string
  const dateRegex = /\d{2}\.\d{2}\.\d{4}/;
  const match = input.match(dateRegex);

  if (match) {
    // Split the date into [day, month, year]
    const [day, month, year] = match[0].split('.');

    // Format the date into YYYY-MM-DD
    const formattedDate = `${year}-${month}-${day}`;
    return formattedDate;
  }
  return null;
}

async function processCouponItem(
  couponElement: cheerio.Element,
  sourceUrl: string,
  sourceDomain: string
) {
  const $coupon = cheerio.load(couponElement);

  const idInSite = $coupon('*').first().attr('data-id');
  if (!idInSite) {
    console.log(`Element data-id attr is missing in ${sourceUrl}`);
    return false;
  }

  let hasCode = false;

  const elemCode = $coupon('div.hidden-code').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  // Extract the voucher title
  const titleElement = $coupon('div.main > h2').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the merchant name
  const shopElement = $coupon('div.main > span.shop').first();
  if (shopElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Merchant name is missing');
  }
  const merchantName = he.decode(shopElement.text().trim());

  // Extract the description
  let description = null;
  const descElement = $coupon('div.main > p').first();
  if (descElement.length !== 0) {
    description = he.decode(descElement.text().trim());
  }

  // Extract the expiration date
  let expiryDateAt;
  const expiryElement = $coupon(
    'div.main > div.footer > div.expiration'
  ).first();
  if (expiryElement.length !== 0) {
    expiryDateAt = he.decode(expiryElement.text().trim());
    expiryDateAt = extractAndFormatDate(expiryDateAt);
  } else {
    expiryDateAt = null;
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', sourceDomain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('expiryDateAt', expiryDateAt);
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

    const domain = getDomainName(request.url);
    // Extract valid coupons
    const validCoupons = $('div#couponContainer > div.coupon');
    for (const validCoupon of validCoupons) {
      await processCouponItem(validCoupon, request.url, domain);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
