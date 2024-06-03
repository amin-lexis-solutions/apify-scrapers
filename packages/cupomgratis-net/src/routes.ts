import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  logError,
  generateHash,
  CouponHashMap,
  CouponItemResult,
  checkCouponIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processCouponItem(couponItem: any, $coupon: cheerio.Root) {
  const isExpired = $coupon('*').attr('class')?.includes('expired');
  const code = $coupon('div.code')?.text().trim();
  const hasCode = !!code;

  // Extract the description
  const descElement = $coupon('div.hidden_details > div.core_post_content');
  let description = '';

  if (descElement.length > 0) {
    description = descElement.text().trim();
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  hasCode ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  return { generatedHash, validator, hasCode, couponUrl: '' };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log, enqueueLinks } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Check if the breadcrumbs element exists to validate the page
    if ($('#core_main_breadcrumbs_left > li').length === 0) {
      logError(`Not a valid page: ${request.url}`);
      return;
    }

    // Extract the text from the last child of the breadcrumbs list to use as the merchant's name
    const merchantName = $('#core_main_breadcrumbs_left > li')
      .last()
      .text()
      .trim();

    if (!merchantName) {
      logError(`Unable to find merchant name ${request.url}`);
      return;
    }

    // Extract valid coupons
    const validCoupons = $('div#active_coupons > div.store_detail_box');
    const expiredCoupons = $('div#expired_coupons > div.store_detail_box');

    const items = [...validCoupons, ...expiredCoupons];

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: items,
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

      const idInSite = $coupon('*').first().attr('id')?.split('_').pop();

      if (!idInSite) {
        logError('idInSite not found in item');
        return;
      }

      const title = $coupon('h3').first().text().trim();

      if (!title) {
        logError('Coupon title not found in item');
        return;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
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
      await enqueueLinks({
        urls: [currentResult.couponUrl],
        userData: {
          label: Label.getCode,
          validatorData: currentResult.validator.getData(),
        },
      });
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
