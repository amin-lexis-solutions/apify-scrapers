import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  checkCouponIds,
  CouponHashMap,
  CouponItemResult,
  generateHash,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  const code = $cheerio('*').first().attr('data-code')?.trim();

  const hasCode = !!code;

  // Extract the description
  let description = '';
  let descElement = $cheerio('div.offerbox-store-title div.longtext').first();

  if (descElement.length === 0) {
    descElement = $cheerio(
      'div.offerbox-store-title span.slutdatum:last-child'
    ).first();
  }

  if (descElement.length > 0) {
    description = he.decode(descElement.text()).trim();
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

    const merchantLink = $(
      'ol.breadcrumb > li:last-child > a > span[itemprop=name]'
    ).first();

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      logError('Merchant name is missing');
      return;
    }

    // Extract valid coupons
    const validCoupons = $('div.active-offers-container div.offerbox-store');

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
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*').first().attr('data-offerid');

      if (!idInSite) {
        logError('idInSite not found in item');
        return;
      }

      // Extract the voucher title
      const title = $cheerio('div.offerbox-store-title > p')
        ?.first()
        ?.text()
        .trim();

      if (!title) {
        logError('titleElement not found in item');
        return;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = await processCouponItem(couponItem, $cheerio);

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
