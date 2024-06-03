import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  getMerchantDomainFromUrl,
  logError,
  CouponHashMap,
  CouponItemResult,
  checkCouponIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import { generateHash } from '../../api/src/utils/utils';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  let hasCode = false;

  let isExpired: boolean | undefined = false;

  const elementClass = $cheerio('*').first().attr('class');

  if (!elementClass) {
    log.warning('Element class is missing');
  }

  isExpired = elementClass?.includes('expire-offer');

  const elemCode = $cheerio('div[data-code]').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  // Extract the voucher terms and conditions
  let termsAndConditions;
  const termsElement = $cheerio('div[data-offer=conditions]').first();
  if (termsElement.length !== 0) {
    termsAndConditions = he.decode(termsElement.text().trim());
  } else {
    termsAndConditions = null;
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('termsAndConditions', termsAndConditions);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  const code = elemCode?.attr('data-code');

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
    log.warning(`Processing URL: ${request.url}`);

    const pageH1Elem = $('h1.shop-page-title');

    const merchantName = he.decode(
      pageH1Elem ? pageH1Elem.text().replace('Codes promo ', '').trim() : ''
    );

    if (!merchantName) {
      logError(`Merchant name not found in sourceUrl ${request.url}`);
      return;
    }

    const domain = getMerchantDomainFromUrl(request.url);

    if (!domain) {
      log.warning('Domain is missing');
    }

    // Extract valid coupons
    const validCoupons = $('div.offer-list-item');

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

      const idInSite = $coupon('*').first().attr('data-id');

      if (!idInSite) {
        logError(`Element data-id attr is missing in ${request.url}`);
        continue;
      }

      // Extract the voucher title
      const title = $coupon('div.h3 > a').first()?.text()?.trim();

      if (!title) {
        logError('Voucher title is missing');
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        domain,
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
