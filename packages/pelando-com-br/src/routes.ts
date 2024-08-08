import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import {
  getMerchantDomainFromUrl,
  generateHash,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
} from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  // Extract the voucher code
  const codeElement =
    $cheerio('span[data-masked]').first() || $cheerio('button[title]').first();

  const code = codeElement.attr('data-masked') || codeElement?.attr('title');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, validator, hasCode: !!code, itemUrl: '' };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context
    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const currentItems = $('ul.sc-a8fe2b69-0 > li > div');
    const expiredItems = $('div.sc-e58a3b10-5 > div');

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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    // Extract JSON data from the script tag
    const scriptContent = $('#schema-data-store').html();

    if (!scriptContent) {
      logger.error('Not a valid merchant page - schema data missing');
      return;
    }

    // Parse the JSON data
    const jsonData = JSON.parse(scriptContent);
    const merchantName = jsonData.name;
    const merchantDomain = getMerchantDomainFromUrl(request.url);
    // Check if valid page
    if (!merchantName) {
      logger.error(`merchantName not found ${request.url}`);
      return;
    }

    // Extract valid coupons
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      // Extract the voucher title
      const titleElement =
        $cheerio('h3').length == 0
          ? $cheerio('p').first()
          : $cheerio('h3').first();

      if (!titleElement) {
        logger.error('title not found in item');
        continue;
      }

      const title = he.decode(
        titleElement
          .text()
          .trim()
          .replace(/[\s\t\r\n]+/g, ' ')
      );

      const idInSite = generateHash(merchantName, title, request.url);

      const itemData = {
        title,
        merchantName,
        merchantDomain,
        idInSite,
        sourceUrl: request.url,
      };

      result = await processItem(itemData, $cheerio);

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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkItemsIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;

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
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
