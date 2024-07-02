import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import {
  processAndStoreData,
  generateItemId,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
  logError,
} from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
function processItem(item: any, $cheerioElement: cheerio.Root): ItemResult {
  // Extract data
  const code = $cheerioElement('.hide span#code')?.text()?.trim();

  const desc = $cheerioElement('.coupon-description')
    ?.text()
    .replaceAll('\n', ' ')
    ?.trim();

  const hasCode = code.length != 0;
  // Add required and optional values to the validator
  const validator = new DataValidator();
  // Add required and optional values to the validator
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('title', item.title);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('description', desc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', hasCode);

  // If coupon code exists, set hasCode to true and add code to validator

  hasCode ? validator.addValue('code', code) : null;

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
  const { request, $, log } = context;
  try {
    log.info(`Listing ${request.url}`);

    // Extract coupons
    const items = $('.coupon-list');

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

    const merchantName = $('.brand-heading h1').text()?.split(' ')?.[0];

    // Throw an error if merchant name is not found
    if (!merchantName) {
      logError('merchantName not found');
      return;
    }

    // Initialize variables
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    // Loop through each coupon element and process it
    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      const title = $cheerioElement('h3 a')?.text()?.trim();

      if (!title) {
        logError(`title not found in item`);
        continue;
      }

      const idInSite = $cheerioElement('.hide')
        .prev()
        .attr('id')
        ?.split('hide-')?.[1];

      if (!idInSite) {
        logError(`idInSite not found in item`);
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerioElement);

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
      // Add coupon
      await processAndStoreData(currentResult.validator, context);
    }
  } finally {
    // Use finally to ensure the actor ends successfully
  }
});
