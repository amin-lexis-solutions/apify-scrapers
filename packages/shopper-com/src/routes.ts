import { createCheerioRouter, log } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import { ItemResult } from 'shared/helpers';
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
  validator.addValue('description', item.description);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', !isVerified);
  validator.addValue('isShown', true);
  validator.addValue('code', code);

  const hasCode = !!code;

  // Return the coupon item result
  return { hasCode, itemUrl: '', validator };
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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
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
    let result: ItemResult;
    // Loop through each coupon element and process it
    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const title = $cheerio('.cc-body-desc-title h2')?.text();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const idInSite = $cheerio('*').attr('data-coupon-id');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const description = $cheerio('*').find('.cc-coupon-details').text();

      const itemData = {
        title,
        merchantName,
        domain,
        idInSite,
        description,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerio);

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
