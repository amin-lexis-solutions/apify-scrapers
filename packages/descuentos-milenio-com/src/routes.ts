import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  generateHash,
  logError,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
  getMerchantDomainFromUrl,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerioElement: cheerio.Root) {
  // Extract the description
  const description = $cheerioElement('div.card-primary__description')?.text();

  // Extract the code
  const code = $cheerioElement('p.code')?.text();

  const dataId = generateHash(item.merchantName, item.title, item.sourceUrl);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', dataId);
  validator.addValue('description', description);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  return { generatedHash: dataId, validator, itemUrl: '', hasCode: !!code };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Processing URL: ${request.url}`);

    // Refactor to use a loop for valid coupons
    const currentItems = $('.brand-index_content-main li div.card-primary');

    const expiredItems = $(
      '.main-section_discounts li.saturate-0 div.card-primary'
    );
    expiredItems.addClass('expired'); // explicity added expired class

    const items = [...currentItems, ...expiredItems];

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

    let merchantName = $(
      'section.brand-index_content-heading-block a img'
    ).attr('title');

    if (!merchantName) {
      logError('Unable to find merchant name');
      return;
    }

    const merchantUrl = $(`.brand-index_content-sidebar a`)
      ?.first()
      ?.attr(`href`);

    if (!merchantUrl) {
      logError(`Merchant domain not found ${request.url}`);
      return;
    }

    const merchantDomain = merchantUrl.includes('.')
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    if (!merchantDomain) {
      log.warning('merchantDomain not found');
    }

    merchantName = merchantName?.replace('Descuentos', '')?.trim();

    // Extract valid coupons
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      const title = $cheerioElement('div.card-primary__title')
        ?.first()
        ?.text()
        ?.trim();

      if (!title || title.length == 0) {
        logError('title not found in item');
        continue;
      }

      const isExpired = $cheerioElement('*')?.hasClass('expired');

      const itemData = {
        title,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
        isExpired,
      };

      result = await processItem(itemData, $cheerioElement);

      if (result.hasCode) {
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

    if (nonExistingIds.length > 0) {
      let currentResult: ItemResult;
      for (const id of nonExistingIds) {
        currentResult = itemsWithCode[id];
        // Process and store the data
        await postProcess(
          {
            SaveDataHandler: {
              validator: currentResult.validator,
            },
          },
          context
        );
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
