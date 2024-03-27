import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, formatDateTime } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;
  let coupon = '';
  let startDateAt = '';
  let expiryDateAt = '';

  const isCodeAttr = $coupon.root().children().first().attr('data-is_code');
  if (isCodeAttr && isCodeAttr.trim() !== '0' && isCodeAttr.trim() !== '') {
    hasCode = true;
  }

  const startDateAttr = $coupon
    .root()
    .children()
    .first()
    .attr('data-start_date');
  if (startDateAttr && startDateAttr.trim()) {
    startDateAt = formatDateTime(startDateAttr);
  }

  const expiryDateAttr = $coupon
    .root()
    .children()
    .first()
    .attr('data-end_date');
  if (expiryDateAttr && expiryDateAttr.trim()) {
    expiryDateAt = formatDateTime(expiryDateAttr);
  }

  const buttonElement = $coupon('div.prominentcode').first();
  if (buttonElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Button element is missing');
  }

  const idInSite = buttonElement.attr('data-v_id')?.trim();

  if (!idInSite || idInSite.trim() === '') {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Missing or empty data-v_id attribute');
  }

  if (hasCode) {
    coupon = buttonElement.attr('data-coupon_code')?.trim() || '';
    if (!coupon || coupon.trim() === '') {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Missing or empty data-coupon_code attribute');
    }
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
  const descElement = $coupon('div.vouchdescription > ul').first();
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
  validator.addValue('title', voucherTitle);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue('expiryDateAt', expiryDateAt);
  validator.addValue('startDateAt', startDateAt);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (hasCode) {
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

    const merchantNameEncoded = $('div.Breadcrumb > div.container_center')
      .contents()
      .filter((i, element) => {
        // element.type === 'text' ensures the node is a text node
        // $.trim($(element).text()) checks if the text is non-empty when trimmed
        return element.type === 'text' && $(element).text().trim() !== '';
      })
      .first()
      .text()
      .trim();

    const merchantName = he.decode(merchantNameEncoded);

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    // Extract valid coupons
    const validCoupons = $('div.rect_shape > div.company_vocuher');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
