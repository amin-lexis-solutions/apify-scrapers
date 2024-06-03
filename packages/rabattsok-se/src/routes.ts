import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
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

export const router = createCheerioRouter();

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  function getDescription() {
    let description;
    const descElement = $cheerio('.coupon-meta p');
    if (descElement) {
      description = descElement.text();
    }
    return description;
  }

  function getCode() {
    let code;
    const codeElement = $cheerio('.showcode .coupon-code');
    if (codeElement) {
      code = codeElement.text();
    }
    return code;
  }

  function couponExpired() {
    let expired = false;
    const isExpiredElement = $cheerio('.coupon-bottom').first().text();
    if (isExpiredElement) {
      expired = !isExpiredElement.includes('Giltig till: Tills vidare');
    }
    return expired;
  }

  const code = getCode();
  const description = getDescription();
  const isExpired = couponExpired();

  const validator = new DataValidator();

  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  return { generatedHash, validator, hasCode: !!code, couponUrl: '' };
}
router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    log.info(`Processing URL: ${request.url}`);

    const merchantElement = $('.bread .breadcrumb .active');

    if (!merchantElement) {
      logError(`merchant name tag not found ${request.url}`);
      return;
    }

    const merchantName = merchantElement.text()?.split('rabattkoder')[0];

    const merchantDomainElement = $(`p:contains("${merchantName}.")`);

    if (!merchantDomainElement) {
      log.warning(`not merchantDomain found in sourceUrl ${request.url}`);
    }

    const merchantDomain = merchantDomainElement
      .text()
      ?.match(/([a-zA-Z0-9]+)\.([a-z]+)/)?.[0];

    const validCoupons = $('.coupon-list .coupon-wrapper');

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

    for (const element of validCoupons) {
      const $coupon = cheerio.load(element);

      const title = $coupon('.coupon-meta h3')?.text();

      if (!title) {
        logError(`title not found in item`);
        continue;
      }

      const idInSite = $coupon('.modal')?.attr('id')?.split('_id_')?.[1];

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        merchantDomain,
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
