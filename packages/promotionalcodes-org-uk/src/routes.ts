import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  generateHash,
  logError,
  CouponItemResult,
  checkCouponIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  const elemCode = $cheerio('div.code').first();

  const hasCode = !!elemCode;

  const idInSite = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const code = elemCode?.text()?.trim();

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
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantElem = $('span.categories.active').first();

    const merchantName = he.decode(
      merchantElem ? merchantElem.text().trim() : ''
    );

    if (!merchantName) {
      logError(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantDomainElement = $(`meta[name=description]`)?.attr(`content`);
    const merchantDomain = merchantDomainElement?.match(
      /([a-zA-Z0-9]+)\.([a-z]+)/
    )?.[0];

    if (!merchantDomain) {
      log.warning(`merchantDomain not found ${request.url}`);
    }

    // Extract valid coupons
    const validCoupons = $('div.offers > article');

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

    const couponsWithCode: any = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const element of validCoupons) {
      const $coupon = cheerio.load(element);

      // Extract the voucher title
      const title = $coupon('h3')?.first()?.text()?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const couponItem = {
        title,
        merchantName,
        merchantDomain,
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
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: currentResult.validator,
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
