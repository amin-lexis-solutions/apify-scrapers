import cheerio from 'cheerio';

import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  generateCouponId,
  CouponItemResult,
} from 'shared/helpers';

import { Label } from 'shared/actor-utils';

export const router = createCheerioRouter();

function processCouponItem(
  merchantName: string,
  element: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(element);

  let hasCode = false;

  const idInSite = $coupon('.card_box').first().attr('data-cid');

  if (!idInSite) {
    console.log(`Element data-id attr is missing in ${sourceUrl}`);
    throw new Error('Element data-promotion-id attr is missing');
  }

  // Extract title
  const titleElement = $coupon('div.title').first();
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

  const elemCode = $coupon('.go_btn .code').first();

  let couponCode;
  if (elemCode.length > 0) {
    hasCode = true;
    couponCode = elemCode.text().trim();
    validator.addValue('code', couponCode);
  }

  let couponUrl;

  if (hasCode) {
    const couponUrlElement = $coupon('.card_box');
    if (couponUrlElement) {
      couponUrl = couponUrlElement.attr('href');
    }
  }
  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }
  try {
    console.log(`\nProcessing URL: ${request.url}`);

    let merchantName = $('.m_logo img').attr('alt');
    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }
    merchantName = merchantName.trim();

    // Extract valid coupons
    let result: CouponItemResult;

    const validCoupons = $('.list_coupons .offer_card');
    for (const element of validCoupons) {
      result = processCouponItem(merchantName, element, request.url);
      await processAndStoreData(result.validator);

      // if (!result.hasCode) {
      //   await processAndStoreData(result.validator);
      // } else {
      //   couponsWithCode[result.generatedHash] = result;
      //   idsToCheck.push(result.generatedHash);
      // }
      // const nonExistingIds = await checkCouponIds(idsToCheck);

      // if (nonExistingIds.length > 0) {
      //   let currentResult: CouponItemResult;
      //   for (const id of nonExistingIds) {
      //     currentResult = couponsWithCode[id];
      //     // Add the coupon URL to the request queue
      //     const response = await crawler.requestQueue.addRequest(
      //       {
      //         url: currentResult.couponUrl,
      //         userData: {
      //           label: Label.getCode,
      //           validatorData: currentResult.validator.getData(),
      //         },
      //         headers: CUSTOM_HEADERS,
      //       },
      //       { forefront: true }
      //     );
      //     console.log(response)
      //   }
      // }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
