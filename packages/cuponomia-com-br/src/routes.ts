import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { CouponHashMap, CouponItemResult, logError } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import { generateHash } from 'shared/helpers';

async function processCouponItem(couponItem: any, $coupon: cheerio.Root) {
  // Extract the description
  const description = $coupon('div.item-desc-wrapper div.item-desc')
    .text()
    .trim();

  const isExpired = $coupon('*').attr('class')?.includes('expired-item');
  // Extract the code

  const codeElement = isExpired
    ? $coupon('div.coupon-info > div.item-title > span.coupon-code > span.code')
    : $coupon('button.item-code > span.item-promo-block > span.item-code-link');

  const code = codeElement.length > 0 ? codeElement.text().trim() : null;

  const hasCode = !!code;
  // Determine if the coupon isExclusive
  const exclusiveElement = $coupon(
    'div.coupon-info > div.coupon-info-complement > div.couponStatus > span.couponStatus-item'
  );
  const exclusiveText =
    exclusiveElement.length > 0 ? exclusiveElement.text().toUpperCase() : '';
  const isExclusive = exclusiveText.includes('EXCLUSIVO');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  return { generatedHash, validator, couponUrl: '', hasCode };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Processing URL: ${request.url}`);

    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    const merchantName = (
      $('div.storeHeader').attr('data-store-name') ||
      $('.item-title h3').attr('data-label')
    )?.toLowerCase();

    if (!merchantName) {
      logError('Unable to find merchant name');
      return;
    }

    // Refactor to use a loop for valid coupons
    const validCoupons = $('ul.coupon-list.valid-coupons > li[data-id]');
    const expiredCoupons = $('ul.coupon-list.expired-coupons > li[data-id]');
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

      // Retrieve 'data-id' attribute
      const idInSite = $coupon('*').attr('data-id') || $coupon('*').attr('id');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const title = $coupon('div.coupon-info > div.item-title > h3')
        ?.text()
        .trim();

      if (!title) {
        logError('title not found in item');
        continue;
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
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
