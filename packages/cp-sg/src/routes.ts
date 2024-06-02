import { createCheerioRouter } from 'crawlee';

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
async function processCouponItem(couponItem: any, $coupon: cheerio.Root) {
  // Initialize a variable
  const description = $coupon('.coupon-des')?.text();
  const code = $coupon('.code-text')?.text();

  // Create a data validator instance
  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const hasCode = !!code;
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
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Listing ${request.url}`);
    // Extract domain
    const domain = $('.breadcrumb .active.section').text();

    const merchantName = $('.header-content h1')?.text()?.split(' ')?.[0];
    // Log error sentry if merchant name is not found
    if (!merchantName) {
      logError('merchantName not found');
      return;
    }
    // Extract coupons
    const couponList = $('.store-listing-item');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: couponList,
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
    for (const element of couponList) {
      const $coupon = cheerio.load(element);

      const title = $coupon('.coupon-title a')?.text();

      if (!title) {
        logError(`Title not found in item`);
        return;
      }

      const idInSite = $coupon('.coupon-detail a')
        .attr('data-url')
        ?.split('c=')[1];

      if (!idInSite) {
        logError(`idInSite not found in item`);
        return;
      }

      const couponItem = {
        title,
        domain,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = await processCouponItem(couponItem, $coupon);

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
    if (nonExistingIds?.length <= 0) return;

    let currentResult: CouponItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
      // Add the coupon URL to the request queue

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
    // Use finally to ensure the actor ends successfully
  }
});
