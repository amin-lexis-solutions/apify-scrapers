import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  checkExistingCouponsAnomaly,
  processAndStoreData,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  context: any,
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  const elementId = $coupon('*').first().attr('id');
  if (!elementId) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element id is missing');
  }

  // The coupon id attr is like "coupomlist_1234"
  // we split the string and get the last element
  const idInSite = elementId.split('_').pop();

  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('ID in site is missing');
  }

  let hasCode = false;
  let code = '';

  // if div.code is present and contains text, the coupon has a code
  const codeElement = $coupon('div.code');
  if (codeElement.length > 0 && codeElement.text().trim()) {
    hasCode = true;
    code = codeElement.text().trim();
  }

  // Extract the voucher title
  const titleElement = $coupon('h3').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  const descElement = $coupon('div.hidden_details > div.core_post_content');
  let description = '';
  if (descElement.length > 0) {
    description = descElement.text().trim();
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

  if (hasCode) {
    validator.addValue('code', code);
  }

  // Process and store the data
  await processAndStoreData(validator, context);
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

    // Check if the breadcrumbs element exists to validate the page
    if ($('#core_main_breadcrumbs_left > li').length === 0) {
      console.log(`Not a valid page: ${request.url}`);
      return;
    }

    // Extract the text from the last child of the breadcrumbs list to use as the merchant's name
    const merchantName = $('#core_main_breadcrumbs_left > li')
      .last()
      .text()
      .trim();

    if (!merchantName) {
      throw new Error('Unable to find merchant name in the breadcrumbs');
    }

    // Extract valid coupons
    const validCoupons = $('div#active_coupons > div.store_detail_box');

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    for (const element of validCoupons) {
      await processCouponItem(
        context,
        merchantName,
        false,
        element,
        request.url
      );
    }

    // Extract expired coupons
    const expiredCoupons = $('div#expired_coupons > div.store_detail_box');
    for (const element of expiredCoupons) {
      await processCouponItem(
        context,
        merchantName,
        true,
        element,
        request.url
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
