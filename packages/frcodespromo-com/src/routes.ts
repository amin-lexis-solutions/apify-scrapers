import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  checkCouponIds,
  CouponHashMap,
  CouponItemResult,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import { generateHash } from '../../api/src/utils/utils';

async function processCouponItem(couponItem: any, $coupon: cheerio.Root) {
  const elemCode = $coupon('span.coupon_code').first();

  const code = elemCode ? elemCode.html() : null;

  const hasCode = !!code;

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  hasCode ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

  return { generatedHash, validator, couponUrl: '', hasCode };
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

    let merchantName = $('a.golink').attr('title');

    if (!merchantName) {
      logError('Unable to find merchant name');
      return;
    }

    merchantName = merchantName?.trim()?.toLowerCase();

    // Extract valid coupons
    const validCoupons = $('div#coupon_list div.c_list > div[data-type]');

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

    for (const element of validCoupons) {
      const $coupon = cheerio.load(element);

      const elementClass = $coupon('*').first().attr('class');

      if (!elementClass) {
        logError('Element class not found in item');
        continue;
      }

      const idInSite = $coupon('div.coupon_word > a')
        ?.first()
        ?.attr('id')
        ?.split('_')[1];

      if (!idInSite) {
        logError(`Element data-id attr is missing in ${request.url}`);
        continue;
      }

      // Extract the voucher title
      const title = $coupon('div.coupon_title')?.first()?.text()?.trim();

      if (!title) {
        logError('Coupon title not found in item');
        continue;
      }

      const couponItem = {
        title,
        merchantName,
        idInSite,
        sourceUrl: request.url,
      };

      result = await processCouponItem(couponItem, $coupon);

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
      // Process and store the data
      await postProcess(
        {
          SaveDataHandler: {
            validator: currentResult.validator,
          },
        },
        context
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
