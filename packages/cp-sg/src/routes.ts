import { createCheerioRouter } from 'crawlee';

import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import { ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

// Function to process a single coupon item from the webpage
async function processItem(item: any, $cheerioElement: cheerio.Root) {
  // Initialize a variable
  const description = $cheerioElement('.coupon-des')?.text();
  const code = $cheerioElement('.code-text')?.text();

  // Create a data validator instance
  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const hasCode = !!code;
  // If coupon code exists, set hasCode to true and add code to validator
  hasCode ? validator.addValue('code', code) : null;

  // Return the coupon item result
  return { hasCode, itemUrl: '', validator };
}
// Handler function for processing coupon listings
router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Listing ${request.url}`);

    // Extract coupons
    const items = $('.store-listing-item');

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

    // Extract domain
    const merchantDomain = $('.breadcrumb .active.section').text();

    const merchantName = $('.header-content h1')?.text()?.split(' ')?.[0];
    // Log error sentry if merchant name is not found
    if (!merchantName) {
      logger.error('merchantName not found');
      return;
    }

    // Initialize variables
    let result: ItemResult;
    // Loop through each coupon element and process it
    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      const title = $cheerioElement('.coupon-title a')?.text();

      if (!title) {
        logger.error(`Title not found in item`);
        return;
      }

      const idInSite = $cheerioElement('.coupon-detail a')
        .attr('data-url')
        ?.split('c=')[1];

      if (!idInSite) {
        logger.error(`idInSite not found in item`);
        return;
      }

      const itemData = {
        title,
        merchantDomain,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = await processItem(itemData, $cheerioElement);

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
