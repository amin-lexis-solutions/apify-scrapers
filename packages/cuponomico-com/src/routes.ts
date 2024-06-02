import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
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
  $coupon: cheerio.Root
): CouponItemResult {
  // verify coupon code
  const hasCode = !!$coupon('a.coupon')
    ?.text()
    ?.toLocaleLowerCase()
    ?.includes('ver cupón');

  // Extract the description
  let description = '';
  const descElement = $coupon('div.trav-list-bod > p').first();
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
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

  return { generatedHash, hasCode, couponUrl: couponItem.couponUrl, validator };
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
    log.info(`\nProcessing URL: ${request.url}`);

    const elementH2 = $('div.hot-page2-alp-con-left-1 > h2');

    const merchantName = he.decode(elementH2?.text()?.trim());

    if (!merchantName) {
      logError('Merchant name is missing');
      return;
    }

    const validCoupons = $(
      'div.hot-page2-alp-con-right-1 > div.row > div.hot-page2-alp-r-list'
    );

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

    // Extract valid coupons
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of validCoupons) {
      const $coupon = cheerio.load(item);

      const title = $coupon('h3').first().text().trim();

      if (!title) {
        logError(`title not found in item`);
        continue;
      }

      const linkElement = $coupon('a.coupon');

      // Extract both 'store-url' and 'coupon-url' attributes
      const couponUrl = linkElement.attr('coupon-url') || '';
      // Define the regex pattern
      const regex = /[?&]cupon=(\d+)/;

      // Attempt to match both URLs against the regex
      const idInSite = couponUrl?.match(regex)?.[1];

      if (!idInSite) {
        logError(`idInSite not found in item`);
        continue;
      }

      const couponItem = {
        title,
        merchantName,
        idInSite,
        sourceUrl: request.url,
        couponUrl,
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

    if (nonExistingIds.length > 0) {
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

    // Extract the coupon code
    const codeInput = $('div#dialog input.txtCode');

    if (codeInput.length === 0) {
      log.warning('Coupon code input is missing');
    }

    const code = codeInput.val().trim();

    // Check if the code is found
    if (!code) {
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
