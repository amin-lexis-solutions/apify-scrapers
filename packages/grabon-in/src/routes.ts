import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  checkItemsIds,
  ItemHashMap,
  ItemResult,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import { generateHash } from 'shared/helpers';

async function processItem(item: any, $cheerioElement: cheerio.Root) {
  const elementDataType = $cheerioElement('*').first().attr('data-type');

  if (!elementDataType) {
    log.warning('Element data-type is missing');
  }

  const hasCode = elementDataType === 'cp';

  const code = $cheerioElement('span.visible-lg')?.first()?.text()?.trim();

  // Extract the description
  let description = '';
  const descElement = $cheerioElement('div.open').first();

  if (descElement.length > 0) {
    description = descElement.text();
    description = description
      .trim() // Remove leading and trailing whitespace
      .replace(/[ \t]+/g, ' ') // Replace multiple whitespace characters with a single space
      .replace(/\n+/g, '\n') // Replace multiple newline characters with a single newline
      .trim(); // Final trim to clean up any leading/trailing whitespace after replacements
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
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
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantLink = $('ul.g-bread > li:last-child');

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().replace('Coupons', '').trim() : ''
    );

    if (!merchantName) {
      log.warning('Merchant name is missing');
    }

    // Extract valid coupons
    const items = $('div.container ul.gmc-list > li > div[data-type]');

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

    // Extract valid coupons
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*').first().attr('data-cid');

      if (!idInSite) {
        logError(`idInSite not found in item ${request.url}`);
        return;
      }

      // Extract the voucher title
      const title = $cheerio('div.gcbr > p').first()?.text().trim();

      if (!title) {
        logError(`title not found in item ${request.url}`);
        return;
      }

      const item = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = await processItem(item, $cheerio);

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
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
