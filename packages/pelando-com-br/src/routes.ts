import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import {
  getMerchantDomainFromUrl,
  generateHash,
  logError,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
} from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  // Extract the voucher code
  const codeElement =
    $cheerio('span[data-masked]').first() || $cheerio('button[title]').first();

  const code = codeElement.attr('data-masked') || codeElement?.attr('title');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExpired', couponItem.isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  return { generatedHash, validator, hasCode: !!code, couponUrl: '' };
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

    // Extract JSON data from the script tag
    const scriptContent = $('#schema-data-store').html();

    if (!scriptContent) {
      logError('Not a valid merchant page - schema data missing');
      return;
    }

    // Parse the JSON data
    const jsonData = JSON.parse(scriptContent);
    const merchantName = jsonData.name;
    const domain = getMerchantDomainFromUrl(request.url);
    // Check if valid page
    if (!merchantName) {
      logError(`merchantName not found ${request.url}`);
      return;
    }

    // Extract valid coupons
    const validCoupons = $('ul.sc-a8fe2b69-0 > li > div');
    const expiredCoupons = $('div.sc-e58a3b10-5 > div');

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

    // Extract valid coupons
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of items) {
      const $coupon = cheerio.load(item);

      // Extract the voucher title
      const titleElement =
        $coupon('h3').length == 0
          ? $coupon('p').first()
          : $coupon('h3').first();

      if (!titleElement) {
        logError('title not found in item');
        continue;
      }

      const title = he.decode(
        titleElement
          .text()
          .trim()
          .replace(/[\s\t\r\n]+/g, ' ')
      );

      const idInSite = generateHash(merchantName, title, request.url);

      const couponItem = {
        title,
        merchantName,
        domain,
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
