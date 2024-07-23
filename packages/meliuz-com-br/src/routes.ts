import cheerio from 'cheerio';
import * as he from 'he';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  checkItemsIds,
  ItemHashMap,
  ItemResult,
  logError,
  generateHash,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  const codeCss = item.isExpired
    ? 'span.expired-cpn-sec__code'
    : 'span.code-btn__value';

  // Extract the voucher code
  const codeElement = $cheerio(codeCss).first();
  let code = '';
  if (codeElement.length !== 0) {
    code = he.decode(
      codeElement
        .text()
        .trim()
        .replace(/[\s\t\r\n]+/g, ' ')
    );
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, validator, hasCode: !!code, itemUrl: '' };
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

    log.info(`Listing ${request.url}`);

    // Extract valid coupons
    const items = $('div.cpn-list__items > div[data-offer-id]');

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

    // Extract the content of the meta tag
    const metaContent = $('meta[property="og:image:alt"]').attr('content');

    // Remove the word "Logotipo" from the extracted content
    const merchantName = metaContent
      ? metaContent.replace('Logotipo ', '')
      : '';

    // Check if valid page
    if (!merchantName) {
      logError(`Not Merchant URL: ${request.url}`);
      return;
    }

    // Extract valid coupons
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const idInSite = $cheerio('*').first().attr('data-offer-id');

      const isExpired = !$cheerio('*').find('.expired-cpn-sec__label');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      // Extract title
      const titleElement = $cheerio('h3.offer-cpn__title').first();

      if (!titleElement) {
        logError('title not found in item');
        continue;
      }

      const title = he.decode(
        titleElement
          .text()
          .trim()
          .replace(/[\s\t\r\n]+/g, ' ')
      );

      const itemData = {
        title,
        isExpired,
        idInSite,
        merchantName,
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
