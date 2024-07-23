import { createCheerioRouter, log } from 'crawlee';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import {
  generateItemId,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();
// Function to process a single coupon item from the webpage
function processItem(item: any, $cheerio: cheerio.Root) {
  const code =
    $cheerio('*').attr('data-coupon') ||
    $cheerio('._coupon-code').text()?.trim();

  const isVerified = $cheerio('.cc-verified-text')
    ?.text()
    ?.includes('Verified Coupon');

  // Create a data validator instance
  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.domain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', !isVerified);
  validator.addValue('isShown', true);
  validator.addValue('code', code);

  const hasCode = !!code;
  // Generate a hash for the coupon
  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );
  // Return the coupon item result
  return { generatedHash, hasCode, itemUrl: '', validator };
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async (context) => {
  const { request, $ } = context;
  try {
    // Extract valid coupons
    const items = $('.couponcards-container .couponcard-container');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            items,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }
    // Extract coupon list elements from the webpage
    const domain = $('.stp_sub-header a._prevent_default').text()?.trim();

    if (!domain) {
      log.info('Domain not found');
    }
    // Extract the merchant name
    const merchantName = domain?.split('.')?.[0];

    // Initialize variables
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;
    // Loop through each coupon element and process it
    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const title = $cheerio('.cc-body-desc-title h2')?.text();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const idInSite = $cheerio('*').attr('data-coupon-id');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const itemData = {
        title,
        merchantName,
        domain,
        idInSite,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerio);

      // If coupon has no code, process and store its data
      if (result.hasCode) {
        // If coupon has a code, store it in a hashmap and add its ID for checking
        itemsWithCode[result.generatedHash] = result;
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
    const nonExistingIds = await checkItemsIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
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
