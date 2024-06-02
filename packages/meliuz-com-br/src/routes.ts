import cheerio from 'cheerio';
import * as he from 'he';
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

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  const codeCss = couponItem.isExpired
    ? 'span.expired-cpn-sec__code'
    : 'span.code-btn__value';

  // Extract the voucher code
  const codeElement = $cheerio(codeCss).first();
  let code = '';
  if (codeElement.length !== 0) {
    code = he.decode(
      codeElement
        .text()
        .trim()
        .replace(/[\s\t\r\n]+/g, ' ')
    );
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExpired', couponItem.isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.idInSite,
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

    log.info(`Listing ${request.url}`);

    // Extract the content of the meta tag
    const metaContent = $('meta[property="og:image:alt"]').attr('content');

    // Remove the word "Logotipo" from the extracted content
    const merchantName = metaContent
      ? metaContent.replace('Logotipo ', '')
      : '';

    // Check if valid page
    if (!merchantName) {
      logError(`Not Merchant URL: ${request.url}`);
      return;
    }

    // Extract valid coupons
    const validCoupons = $('div.cpn-list__items > div[data-offer-id]');

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

      const idInSite = $coupon('*').first().attr('data-offer-id');

      const isExpired = !$coupon('*').find('.expired-cpn-sec__label');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      // Extract title
      const titleElement = $coupon('h3.offer-cpn__title').first();

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

      const couponItem = {
        title,
        isExpired,
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
