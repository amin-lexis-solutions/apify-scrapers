import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import {
  processAndStoreData,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
} from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';
import { Label } from 'shared/actor-utils';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
function processCouponItem(
  merchantName: string,
  element: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  // Load the coupon element using Cheerio
  const $coupon = cheerio.load(element);
  // Extract data
  const code = $coupon('.hide span#code')?.text()?.trim();
  const title = $coupon('h3 a')?.text()?.trim();
  const desc = $coupon('.coupon-description')
    ?.text()
    .replaceAll('\n', ' ')
    ?.trim();
  const idInSite = $coupon('.hide').prev().attr('id')?.split('hide-')?.[1];
  // Throw an error if ID is not found
  if (!idInSite) {
    throw new Error('Element data-promotion-id attr is missing');
  }
  const hasCode = code.length != 0 ? true : false;
  // Add required and optional values to the validator
  const validator = new DataValidator();
  // Add required and optional values to the validator
  validator.addValue('idInSite', idInSite);
  validator.addValue('title', title);
  validator.addValue('merchantName', merchantName);
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('description', desc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', hasCode);
  // If coupon code exists, set hasCode to true and add code to validator
  if (hasCode) {
    validator.addValue('code', code);
  }
  // Generate a hash for the coupon
  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);
  // Return the coupon item result
  return { generatedHash, hasCode, couponUrl: '', validator };
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async ({ request, $, log }) => {
  try {
    log.info(`Listing ${request.url}`);

    const merchantName = $('.brand-heading h1').text()?.split(' ')?.[0];
    // Throw an error if merchant name is not found
    if (!merchantName) {
      throw new Error('merchantName not found');
    }
    // Extract coupons
    const validCoupons = $('.coupon-list');
    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    // Loop through each coupon element and process it
    for (const coupon of validCoupons) {
      result = processCouponItem(merchantName, coupon, request.url);
      if (result.hasCode) {
        // If coupon has a code, store it in a hashmap and add its ID for checking
        couponsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
      } else {
        await processAndStoreData(result.validator);
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length <= 0) return;

    let currentResult: CouponItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
      // Add coupon
      await processAndStoreData(currentResult.validator);
    }
  } finally {
    // Use finally to ensure the actor ends successfully
  }
});
