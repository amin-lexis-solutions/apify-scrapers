import { createCheerioRouter, log } from 'crawlee';
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
function processCouponItem(
  domain: string,
  merchantName: string,
  element: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(element);

  const title = $coupon('.cc-body-desc-title h2')?.text();
  const code =
    $coupon('*').attr('data-coupon') || $coupon('._coupon-code').text()?.trim();
  const idInSite = $coupon('*').attr('data-coupon-id');
  const isVerified = $coupon('.cc-verified-text')
    ?.text()
    ?.includes('Verified Coupon');
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
  validator.addValue('isExpired', !isVerified);
  validator.addValue('isShown', true);
  validator.addValue('code', code);

  const hasCode = code ? true : false;
  // Generate a hash for the coupon
  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);
  // Return the coupon item result
  return { generatedHash, hasCode, couponUrl: '', validator };
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async ({ request, $ }) => {
  try {
    // Extract coupon list elements from the webpage
    const domain = $('.stp_sub-header a._prevent_default').text()?.trim();

    if (!domain) {
      log.info('Domain not found');
    }
    // Extract the merchant name
    const merchantName = domain?.split('.com')?.[0];
    // Extract valid coupons
    const validCoupons = $('.couponcards-container .couponcard-container');
    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    // Loop through each coupon element and process it
    for (const coupon of validCoupons) {
      result = processCouponItem(domain, merchantName, coupon, request.url);
      // If coupon has no code, process and store its data
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
    if (nonExistingIds.length == 0) return;

    let currentResult: CouponItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
      await processAndStoreData(currentResult.validator);
    }
  } finally {
    // Use finally to ensure the actor ends successfully
  }
});
