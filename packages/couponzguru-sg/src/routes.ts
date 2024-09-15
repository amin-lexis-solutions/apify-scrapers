import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { ItemResult } from 'shared/helpers';
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

  // Return the coupon item result
  return { hasCode, itemUrl: '', validator };
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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    const merchantName = $('.brand-heading h1').text()?.split(' ')?.[0];

    // Throw an error if merchant name is not found
    if (!merchantName) {
      logger.error('merchantName not found');
      return;
    }

    // Initialize variables
    let result: ItemResult;

    // Loop through each coupon element and process it
    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      const title = $cheerioElement('h3 a')?.text()?.trim();

      if (!title) {
        logger.error(`title not found in item`);
        continue;
      }

      const idInSite = $cheerioElement('.hide')
        .prev()
        .attr('id')
        ?.split('hide-')?.[1];

      if (!idInSite) {
        logger.error(`idInSite not found in item`);
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerioElement);

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
  } finally {
    // Use finally to ensure the actor ends successfully
  }
});
