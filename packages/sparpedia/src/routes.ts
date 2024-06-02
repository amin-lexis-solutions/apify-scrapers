import cheerio from 'cheerio';
import * as he from 'he';
import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  logError,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processCouponItem(
  couponItem: any,
  $cheerio: cheerio.Root
): CouponItemResult {
  let couponUrl = '';
  const elementClass = $cheerio('*').first().attr('class');

  if (!elementClass) {
    log.warning('Element class is missing');
  }

  const hasCode = !!elementClass?.includes('offer-label-type-code');

  if (hasCode) {
    couponUrl = `${couponItem.sourceUrl}?popup_id=${couponItem.idInSite}`;
  }

  // Extract the description
  const descElement = $cheerio('div.voor');
  let description = '';
  if (descElement.length > 0) {
    description = descElement.text().trim();
  }

  // Check if the coupon is exclusive
  let isExclusive = false;
  const exclusiveElement = $cheerio('span.label-exclusive');
  if (exclusiveElement.length > 0) {
    isExclusive = true;
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', couponItem.isExpired);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantElem = $('ol.mrk-breadcrumbs > li:last-child');

    const merchantName = he.decode(
      merchantElem ? merchantElem.text().trim() : ''
    );

    if (!merchantName) {
      logError('Merchant name is missing');
      return;
    }

    // Extract valid coupons
    const validCoupons = $(
      'div.current-shop-offers > div.offer-default.not-expired'
    );
    // Extract expired coupons
    const expiredCoupons = $(
      'div.current-shop-offers > div.offer-default.has-expired'
    );

    const items = [...validCoupons, ...expiredCoupons];

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

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of items) {
      const $coupon = cheerio.load(item);

      const isExpired = !!$coupon('*').hasClass('has-expired');

      const idAttr = $coupon('*').first().attr('id')?.trim();

      if (!idAttr) {
        log.warning('Element ID attr not found in item');
      }

      // Extract the ID from the ID attribute
      const idInSite = idAttr?.split('-')?.pop();

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const title = $coupon('h3 > a').first().text().trim();

      if (!title) {
        logError('Voucher title is missing');
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
        isExpired,
        sourceUrl: request.url,
      };

      result = processCouponItem(couponItem, $coupon);

      if (result.hasCode) {
        couponsWithCode[result.generatedHash] = result;
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
      // Add the coupon URL to the request queue
      await crawler.requestQueue.addRequest(
        {
          url: currentResult.couponUrl,
          userData: {
            label: Label.getCode,
            validatorData: currentResult.validator.getData(),
          },
          headers: CUSTOM_HEADERS,
        },
        { forefront: true }
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, $, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const codeInput = $('div.code-popup > input[type="text"]').first();
    if (!codeInput) {
      log.warning('Coupon code input element is missing');
    }
    const code = codeInput.val()?.trim();

    // Check if the code is found
    if (!code) {
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await processAndStoreData(validator, context);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
