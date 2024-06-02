import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  checkCouponIds,
  CouponHashMap,
  CouponItemResult,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import { generateHash } from 'shared/helpers';

async function processCouponItem(couponItem: any, $coupon: cheerio.Root) {
  const elementDataType = $coupon('*').first().attr('data-type');

  if (!elementDataType) {
    log.warning('Element data-type is missing');
  }

  const hasCode = elementDataType === 'cp';

  const code = $coupon('span.visible-lg')?.first()?.text()?.trim();

  // Extract the description
  let description = '';
  const descElement = $coupon('div.open').first();

  if (descElement.length > 0) {
    description = descElement.text();
    description = description
      .trim() // Remove leading and trailing whitespace
      .replace(/[ \t]+/g, ' ') // Replace multiple whitespace characters with a single space
      .replace(/\n+/g, '\n') // Replace multiple newline characters with a single newline
      .trim(); // Final trim to clean up any leading/trailing whitespace after replacements
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
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantLink = $('ul.g-bread > li:last-child');

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().replace('Coupons', '').trim() : ''
    );

    if (!merchantName) {
      log.warning('Merchant name is missing');
    }

    // Extract valid coupons
    const validCoupons = $('div.container ul.gmc-list > li > div[data-type]');

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

      const idInSite = $coupon('*').first().attr('data-cid');

      if (!idInSite) {
        logError(`idInSite not found in item ${request.url}`);
        return;
      }

      // Extract the voucher title
      const title = $coupon('div.gcbr > p').first()?.text().trim();

      if (!title) {
        logError(`title not found in item ${request.url}`);
        return;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
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
