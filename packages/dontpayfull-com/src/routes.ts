import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  generateCouponId,
  CouponHashMap,
  checkCouponIds,
  CouponItemResult,
} from 'shared/helpers';
import { createPuppeteerRouter } from 'crawlee';

export const router = createPuppeteerRouter();

function extractDomainFromUrl(url: string): string {
  // Regular expression to extract the domain name
  const regex = /https?:\/\/[^/]+\/[^/]+\/([^/]+)/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Remove 'www.' if present
    if (matches[1].startsWith('www.')) {
      return matches[1].substring(4);
    }
    return matches[1];
  }

  return '';
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async ({ request, page, enqueueLinks }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`Listing ${request.url}`);
    // Extract the merchant name

    await page.waitForTimeout(5000); // Wait for 5 seconds

    const merchantName = await page.$eval('.sidebar-menu-box a', (a) =>
      a?.getAttribute('data-store')
    );
    // Throw an error if merchant name is not found
    if (!merchantName) {
      throw new Error('merchantName not found');
    }
    // Extract coupon list elements from the webpage
    const domain = extractDomainFromUrl(request.url);

    const couponList = await page.$$('#active-coupons li.obox');

    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    // Loop through each coupon element and process it
    for (const element of couponList) {
      let hasCode = false;

      const title = await element.$eval('h3', (title) =>
        title?.textContent?.trim()
      );
      const idInSite = await element.evaluate((node) =>
        node?.getAttribute('data-id')
      );
      // Throw an error if ID is not found
      if (!idInSite) {
        return;
      }
      hasCode = await element.evaluate((node) => {
        const attr = node?.getAttribute('data-coupon');
        return attr?.includes('yes') ? true : false;
      });
      // Create a data validator instance
      const validator = new DataValidator();
      // Add required and optional values to the validator
      validator.addValue('merchantName', merchantName);
      validator.addValue('domain', domain);
      validator.addValue('title', title);
      validator.addValue('sourceUrl', request.url);
      validator.addValue('idInSite', idInSite);

      validator.addValue('isShown', true);
      validator.addValue('isExpired', false);
      // Generate a hash for the coupon
      const generatedHash = generateCouponId(
        merchantName,
        idInSite,
        request.url
      );

      const couponUrl = `https://www.dontpayfull.com/at/${domain}?c=${idInSite}#c${idInSite}`;

      result = { generatedHash, hasCode, couponUrl, validator };

      // If coupon has no code, process and store its data
      if (!result.hasCode) {
        await processAndStoreData(result.validator);
      } else {
        couponsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length > 0) {
      let currentResult: CouponItemResult;

      for (const id of nonExistingIds) {
        currentResult = couponsWithCode[id];
        // Add the coupon URL to the request queue
        await enqueueLinks({
          urls: [currentResult.couponUrl],
          userData: {
            label: Label.getCode,
            validatorData: currentResult.validator,
          },
          forefront: true,
        });
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
// Handler function for processing coupon code
router.addHandler(Label.getCode, async ({ page, request }) => {
  if (request.userData.label !== Label.getCode) return;

  try {
    await page.waitForTimeout(5000); // Wait for 5 seconds

    await page.waitForSelector('.floating-box-content');

    console.log(`${request.url}`);
    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const modal = await page.$('.floating-box-content');

    if (modal === null) {
      throw new Error('Coupon code input is missing');
    }

    const code = await page.$eval(
      '.code-box.code',
      (node) => node?.textContent
    );
    // Check if the code is found
    if (code === null) {
      throw new Error('Coupon code not found in the HTML content');
    }
    console.log(`Found code: ${code}\n    at: ${request.url}`);
    // Add the decoded code to the validator's data

    validator.addValue('code', code);
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
