import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  getDomainName,
} from 'shared/helpers';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
function processCouponItem(
  merchantName: string,
  domain: string | null,
  couponElement: cheerio.Element,
  couponUrl: string
): CouponItemResult {
  // Load the coupon element using Cheerio
  const $coupon = cheerio.load(couponElement);
  // Function to extract the title of the coupon
  function extractTitle() {
    const titleElement = $coupon('.card-text h3');
    if (titleElement) {
      return titleElement.text();
    }
    return;
  }
  // Function to extract the description of the coupon
  function extractDescription() {
    return $coupon('p.show-txt')?.text();
  }
  // Function to extract the coupon code (if available)
  function extractCode() {
    const codeElement = $coupon('.item-code .hiddenCode');
    const code = codeElement.text();
    return code.length == 0 || code.includes('no code need') ? null : code;
  }
  // Function to check if the coupon is expired
  function extractExpired() {
    const expireElement = $coupon('.expires span').first();
    return expireElement?.text()?.includes('expired');
  }
  // Initialize variables

  let hasCode = false;
  const title = extractTitle();
  const description = extractDescription();
  const code = extractCode();
  const isExpired = extractExpired();

  const idInSite = $coupon('*')?.attr('data-cid');
  // Throw an error if ID is not found
  if (!idInSite) {
    throw new Error('idInSite not found');
  }
  // Create a data validator instance
  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);
  // If coupon code exists, set hasCode to true and add code to validator
  if (code) {
    hasCode = true;
    validator.addValue('code', code);
  }
  // Generate a hash for the coupon
  const generatedHash = generateCouponId(merchantName, idInSite, couponUrl);
  // Return the coupon item result
  return { generatedHash, hasCode, couponUrl, validator };
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async ({ request, $, log }) => {
  try {
    console.log(`Listing ${request.url}`);
    // Extract the merchant name
    const merchantName = $('img.merchant-logo')?.attr('title');
    // Throw an error if merchant name is not found
    if (!merchantName) {
      throw new Error('merchantName not found');
    }
    // Extract coupon list elements from the webpage
    const domain = getDomainName(request.url);

    if (!domain) {
      log.warning('Domain is missing!');
    }

    const couponList = $('.promo-container.code');

    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    // Loop through each coupon element and process it
    for (const element of couponList) {
      result = processCouponItem(merchantName, domain, element, request.url);
      // If coupon has no code, process and store its data
      if (!result?.hasCode) {
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
