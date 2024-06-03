import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';

import { DataValidator } from 'shared/data-validator';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import {
  generateCouponId,
  CouponHashMap,
  checkCouponIds,
  CouponItemResult,
  logError,
} from 'shared/helpers';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }
  try {
    // Find all valid coupons on the page
    const validCoupons = $('#codes .offer-item');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: validCoupons,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    // Iterate over each coupon to extract url
    for (const coupon of validCoupons) {
      const id = $(coupon).attr('data-cid');

      if (!id) {
        logError(`idInsite not found in item`);
        continue;
      }
      // Construct coupon URL
      const couponUrl = `${request.url}?show=${id}`;

      await crawler.requestQueue.addRequest(
        {
          url: couponUrl,
          userData: {
            label: Label.details,
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

router.addHandler(Label.details, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.details) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  const items = $('#codes .offer-item');

  // Extract domain from the request URL
  const merchantDomain = $('.shop-link.go span')?.text();

  if (!merchantDomain) {
    log.warning(`merchantDomain not found`);
  }

  const merchantName: any = $('.img-holder a img')?.attr('alt');

  if (!merchantName) {
    logError(`merchantName not found ${request.url}`);
    return;
  }
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

    if (!title) {
      logError(`title not found in item`);
      continue;
    }
    const desc = $coupon('.-description')?.text()?.trim();
    const idInSite = $coupon('*')?.attr('data-cid');

    if (!idInSite) {
      logError(`idInSite not found in item`);
      continue;
    }

    const code = $coupon('.-code-container')?.attr('data-clipboard-text');
    const couponUrl = request.url;

    // Create a DataValidator instance and populate it with coupon data
    const validator = new DataValidator();

    validator.addValue('domain', merchantDomain);
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

    const hasCode = !!code;

    // Create a result object containing generated hash, code availability, coupon URL, and validator data
    result = { generatedHash, hasCode, couponUrl, validator };

    // If the coupon does not have a code, process and store its data using the validator
    if (result.hasCode) {
      // If the coupon has a code, store its details in the couponsWithCode object
      couponsWithCode[result.generatedHash] = result;
      // Add the generated hash to the list of IDs to check
      idsToCheck.push(result.generatedHash);
      continue;
    }

    try {
      await postProcess(
        {
          SaveDataHandler: {
            validator: result.validator,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Post-Processing Error : ${error.message}`);
      return;
    }
  }

  // Call the API to check if the coupon exists
  const nonExistingIds = await checkCouponIds(idsToCheck);

  if (nonExistingIds.length == 0) return;

  let currentResult: CouponItemResult;

  for (const id of nonExistingIds) {
    currentResult = couponsWithCode[id];
    // Enqueue the coupon URL for further processing with appropriate label and validator data
    await postProcess(
      {
        SaveDataHandler: {
          validator: currentResult.validator,
        },
      },
      context
    );
  }
});
