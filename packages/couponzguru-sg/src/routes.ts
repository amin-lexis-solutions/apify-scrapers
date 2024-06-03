import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import {
  processAndStoreData,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  logError,
} from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
function processCouponItem(
  couponItem: any,
  $coupon: cheerio.Root
): CouponItemResult {
  // Extract data
  const code = $coupon('.hide span#code')?.text()?.trim();

  const desc = $coupon('.coupon-description')
    ?.text()
    .replaceAll('\n', ' ')
    ?.trim();

  const hasCode = code.length != 0;
  // Add required and optional values to the validator
  const validator = new DataValidator();
  // Add required and optional values to the validator
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('title', couponItem.title);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('description', desc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', hasCode);

  // If coupon code exists, set hasCode to true and add code to validator

  hasCode ? validator.addValue('code', code) : null;

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
  const { request, $, log } = context;
  try {
    log.info(`Listing ${request.url}`);

    const merchantName = $('.brand-heading h1').text()?.split(' ')?.[0];

    // Throw an error if merchant name is not found
    if (!merchantName) {
      logError('merchantName not found');
      return;
    }
    // Extract coupons
    const validCoupons = $('.coupon-list');

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

      const title = $coupon('h3 a')?.text()?.trim();

      if (!title) {
        logError(`title not found in item`);
        continue;
      }

      const idInSite = $coupon('.hide').prev().attr('id')?.split('hide-')?.[1];

      if (!idInSite) {
        logError(`idInSite not found in item`);
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = processCouponItem(couponItem, $coupon);

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
      // Add coupon
      await processAndStoreData(currentResult.validator, context);
    }
  } finally {
    // Use finally to ensure the actor ends successfully
  }
});
