import { createCheerioRouter, log } from 'crawlee';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import {
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();
// Function to process a single coupon item from the webpage
function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  const code =
    $cheerio('*').attr('data-coupon') ||
    $cheerio('._coupon-code').text()?.trim();

  const isVerified = $cheerio('.cc-verified-text')
    ?.text()
    ?.includes('Verified Coupon');

  // Create a data validator instance
  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExpired', !isVerified);
  validator.addValue('isShown', true);
  validator.addValue('code', code);

  const hasCode = !!code;
  // Generate a hash for the coupon
  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );
  // Return the coupon item result
  return { generatedHash, hasCode, couponUrl: '', validator };
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async (context) => {
  const { request, $ } = context;
  try {
    // Extract coupon list elements from the webpage
    const domain = $('.stp_sub-header a._prevent_default').text()?.trim();

    if (!domain) {
      log.info('Domain not found');
    }
    // Extract the merchant name
    const merchantName = domain?.split('.')?.[0];
    // Extract valid coupons
    const validCoupons = $('.couponcards-container .couponcard-container');

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
    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    // Loop through each coupon element and process it
    for (const coupon of validCoupons) {
      const $coupon = cheerio.load(coupon);

      const title = $coupon('.cc-body-desc-title h2')?.text();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const idInSite = $coupon('*').attr('data-coupon-id');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const couponItem = {
        title,
        merchantName,
        domain,
        idInSite,
        sourceUrl: request.url,
      };

      result = processCouponItem(couponItem, $coupon);

      // If coupon has no code, process and store its data
      if (result.hasCode) {
        // If coupon has a code, store it in a hashmap and add its ID for checking
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
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length == 0) return;

    let currentResult: CouponItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
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
    // Use finally to ensure the actor ends successfully
  }
});
