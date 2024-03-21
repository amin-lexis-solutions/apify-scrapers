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

  const idInSite = $coupon('div.coupon_word > a')
    .first()
    .attr('id')
    ?.split('_')[1];
  if (!idInSite) {
    console.log(`Element data-id attr is missing in ${sourceUrl}`);
    return false;
  }

  let hasCode = false;
  let coupon = '';

  const elementClass = $coupon('*').first().attr('class');
  if (!elementClass) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  const elemCode = $coupon('span.coupon_code').first();

  if (elemCode.length > 0) {
    hasCode = true;
    coupon = elemCode.html()!.trim();
  }

  // Extract the voucher title
  const titleElement = $coupon('div.coupon_title').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
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

    let merchantName = $('a.golink').attr('title');
    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }

    merchantName = merchantName.trim();

    // Extract valid coupons
    const validCoupons = $('div#coupon_list div.c_list > div[data-type]');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
