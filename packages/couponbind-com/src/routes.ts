import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  generateItemId,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
  getMerchantDomainFromUrl,
} from 'shared/helpers';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
function processItem(item: any, couponElement: cheerio.Root): ItemResult {
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
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
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
  const { request, $, log } = context;
  try {
    log.info(`Listing ${request.url}`);

    const items = [
      ...$('.promo-container.code'),
      ...$('.promo-container.deal'),
    ];

    // pre-pressing hooks  here to avoid unnecessary requests
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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    // Extract the merchant name
    const merchantName = $('img.merchant-logo')?.attr('title') || '';
    // Throw an error if merchant name is not found
    if (!merchantName) {
      logger.error(`merchantName not found ${request.url}`);
      return;
    }
    // Extract coupon list elements from the webpage
    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('Domain is missing!');
    }

    // Initialize variables
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    // Loop through each coupon element and process it
    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      const title = $cheerioElement('.card-text h3').text();

      // Logs if ID is not found
      if (!title) {
        logger.error('Title not found in item');
        continue;
      }

      const idInSite = $cheerioElement('*')?.attr('data-cid');
      // Throw an error if ID is not found
      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const itemData = {
        idInSite,
        title,
        merchantName,
        merchantDomain,
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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }

    // Call the API to check if the coupon exists
    const nonExistingIds = await checkItemsIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds?.length <= 0) return;

    let currentResult: ItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }
  } finally {
    // Use finally to ensure the actor ends successfully
  }
});
