import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  logError,
  generateHash,
  ItemHashMap,
  ItemResult,
  checkItemsIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any, $cheerioElement: cheerio.Root) {
  const isExpired = $cheerioElement('*').attr('class')?.includes('expired');
  const code = $cheerioElement('div.code')?.text().trim();
  const hasCode = !!code;

  // Extract the description
  const descElement = $cheerioElement(
    'div.hidden_details > div.core_post_content'
  );
  let description = '';

  if (descElement.length > 0) {
    description = descElement.text().trim();
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  hasCode ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, validator, hasCode, itemUrl: '' };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log, enqueueLinks } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const currentItems = $('div#active_coupons > div.store_detail_box');
    const expiredItems = $('div#expired_coupons > div.store_detail_box');

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

    // Check if the breadcrumbs element exists to validate the page
    if ($('#core_main_breadcrumbs_left > li').length === 0) {
      logError(`Not a valid page: ${request.url}`);
      return;
    }

    // Extract the text from the last child of the breadcrumbs list to use as the merchant's name
    const merchantName = $('#core_main_breadcrumbs_left > li')
      .last()
      .text()
      .trim();

    if (!merchantName) {
      logError(`Unable to find merchant name ${request.url}`);
      return;
    }

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const idInSite = $cheerio('*').first().attr('id')?.split('_').pop();

      if (!idInSite) {
        logError('idInSite not found in item');
        return;
      }

      const title = $cheerio('h3').first().text().trim();

      if (!title) {
        logError('Coupon title not found in item');
        return;
      }

      const itemData = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerio);

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

    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;

    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];

      // Add the coupon URL to the request queue
      if (!currentResult.itemUrl) continue;

      await enqueueLinks({
        urls: [currentResult.itemUrl],
        userData: {
          label: Label.getCode,
          validatorData: currentResult.validator.getData(),
        },
      });
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
