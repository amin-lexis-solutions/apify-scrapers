import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
function processCouponItem(
  couponItem: any,
  couponElement: cheerio.Root
): CouponItemResult {
  // Function to extract the description of the coupon
  function extractDescription() {
    return couponElement('p.show-txt')?.text();
  }
  // Function to extract the coupon code (if available)
  function extractCode() {
    const codeElement = couponElement('.item-code .hiddenCode');
    const code = codeElement?.text();

    return code.length == 0 || code.includes('no code need') ? null : code;
  }
  // Function to check if the coupon is expired
  function extractExpired() {
    const expireElement = couponElement('.expires span').first();
    return expireElement?.text()?.toLocaleLowerCase()?.includes('expired');
  }

  const description = extractDescription();
  const code = extractCode();
  const isExpired = extractExpired();

  // Create a data validator instance
  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
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
  const { request, $, log } = context;
  try {
    log.info(`Listing ${request.url}`);
    // Extract the merchant name
    const merchantName = $('img.merchant-logo')?.attr('title') || '';
    // Throw an error if merchant name is not found
    if (!merchantName) {
      logError(`merchantName not found ${request.url}`);
      return;
    }
    // Extract coupon list elements from the webpage
    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('Domain is missing!');
    }

    const items = [
      ...$('.promo-container.code'),
      ...$('.promo-container.deal'),
    ];

    // pre-pressing hooks  here to avoid unnecessary requests
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

    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    // Loop through each coupon element and process it
    for (const item of items) {
      const $item = cheerio.load(item);

      const title = $item('.card-text h3').text();

      // Logs if ID is not found
      if (!title) {
        logError('Title not found in item');
        continue;
      }

      const idInSite = $item('*')?.attr('data-cid');
      // Throw an error if ID is not found
      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const couponItem = {
        idInSite,
        title,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = processCouponItem(couponItem, $item);

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
      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator: currentResult.validator,
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
    // Use finally to ensure the actor ends successfully
  }
});
