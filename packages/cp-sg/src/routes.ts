import { createCheerioRouter } from 'crawlee';

import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
async function processCouponItem(
  domain: string,
  merchantName: string,
  element: cheerio.Element,
  sourceUrl: string
) {
  // Load the coupon element using Cheerio
  const $coupon = cheerio.load(element);
  // Initialize a variable to track whether a coupon code is present
  let hasCode = false;

  // Extract data
  const title = $coupon('.coupon-title a')?.text();
  const idInSite = $coupon('.coupon-detail a').attr('data-cid');
  const desc = $coupon('.coupon-des')?.text();
  const code = $coupon('.code-text')?.text();
  // Throw an error if ID is not found
  if (!idInSite) {
    throw new Error('idInSite not found');
  }
  // Create a data validator instance
  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', desc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);
  // If coupon code exists, set hasCode to true and add code to validator
  if (code) {
    hasCode = true;
    validator.addValue('code', code);
  }
  // Generate a hash for the coupon
  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);
  // Return the coupon item result
  return { generatedHash, hasCode, couponUrl: '', validator };
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async ({ request, $ }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    // Extract domain
    const domain = $('.breadcrumb .active.section').text();

    const merchantName = $('.header-content h1')?.text()?.split(' ')?.[0];
    // Throw an error if merchant name is not found
    if (!merchantName) {
      throw new Error('merchantName not found');
    }
    // Extract coupons
    const couponList = $('.store-listing-item');

    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    // Loop through each coupon element and process it
    for (const element of couponList) {
      result = await processCouponItem(
        domain,
        merchantName,
        element,
        request.url
      );
      if (!result.hasCode) {
        await processAndStoreData(result.validator);
      } else {
        // If coupon has a code, store it in a hashmap and add its ID for checking
        couponsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
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
      await processAndStoreData(currentResult?.validator);
    }
  } finally {
    // Use finally to ensure the actor ends successfully
  }
});
