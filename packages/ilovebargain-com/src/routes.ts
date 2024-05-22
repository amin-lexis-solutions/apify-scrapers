import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';

import { DataValidator } from 'shared/data-validator';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import {
  processAndStoreData,
  generateCouponId,
  CouponHashMap,
  checkCouponIds,
  CouponItemResult,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }
  try {
    // Find all valid coupons on the page
    const validCoupons = $('#codes .offer-item');

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }
    // Iterate over each coupon to extract url
    for (const coupon of validCoupons) {
      const id = $(coupon).attr('data-cid');
      // Construct coupon URL
      const couponUrl = `${request.url}?show=${id}`;

      await crawler.requestQueue.addRequest(
        {
          url: couponUrl,
          userData: {
            label: Label.getCode,
            id: id,
          },
          headers: CUSTOM_HEADERS,
        },
        { forefront: true }
      );
    }
  } finally {
    // We don't catch errors explicitly so that they are logged in Sentry,
    // but we use finally to ensure proper cleanup and termination of the actor.
  }
});
router.addHandler(Label.getCode, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.getCode) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  const items = $('#codes .offer-item');

  // Extract domain from the request URL
  const domain = $('.shop-link.go span')?.text();

  const merchantName: any = $('.img-holder a img')?.attr('alt');

  // Extract validCoupons
  const couponsWithCode: CouponHashMap = {};
  const idsToCheck: string[] = [];
  let result: CouponItemResult;

  for (const item of items) {
    const $coupon = cheerio.load(item);
    const title = $coupon('.-offer-title .code-link-popup')
      ?.text()
      ?.trim()
      ?.split('Discount')?.[0];
    const desc = $coupon('.-description')?.text()?.trim();
    const idInSite = $coupon('*')?.attr('data-cid');
    const code = $coupon('.-code-container')?.attr('data-clipboard-text');
    const couponUrl = request.url;

    if (!idInSite || !merchantName) return;
    // Create a DataValidator instance and populate it with coupon data
    const validator = new DataValidator();
    validator.addValue('domain', domain);
    validator.addValue('sourceUrl', request.url);
    validator.addValue('merchantName', merchantName);
    validator.addValue('title', title);
    validator.addValue('code', code);
    validator.addValue('idInSite', idInSite);
    validator.addValue('description', desc);
    validator.addValue('isExpired', false);
    validator.addValue('isShown', true);

    // Generate a unique hash for the coupon using merchant name, unique ID, and request URL
    const generatedHash = generateCouponId(merchantName, idInSite, request.url);

    const hasCode = code ? true : false;

    // Create a result object containing generated hash, code availability, coupon URL, and validator data
    result = { generatedHash, hasCode, couponUrl, validator };

    // If the coupon does not have a code, process and store its data using the validator
    if (result.hasCode) {
      // If the coupon has a code, store its details in the couponsWithCode object
      couponsWithCode[result.generatedHash] = result;
      // Add the generated hash to the list of IDs to check
      idsToCheck.push(result.generatedHash);
    } else {
      await processAndStoreData(result.validator);
    }
  }

  // Call the API to check if the coupon exists
  const nonExistingIds = await checkCouponIds(idsToCheck);

  if (nonExistingIds.length == 0) return;

  let currentResult: CouponItemResult;

  for (const id of nonExistingIds) {
    currentResult = couponsWithCode[id];
    // Enqueue the coupon URL for further processing with appropriate label and validator data
    await processAndStoreData(currentResult.validator);
  }
});
