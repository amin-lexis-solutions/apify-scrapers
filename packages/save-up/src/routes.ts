import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  checkItemsIds,
  ItemHashMap,
  ItemResult,
  generateHash,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  // Extract the description
  const descElement = $cheerio('p.voucher-details');
  const description = descElement.length > 0 ? descElement.text().trim() : '';

  // Extract the code
  let code = '';
  const codeElement = $cheerio('span#coupon-code');

  if (codeElement.length > 0) {
    code = codeElement.text().trim();
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (code) {
    validator.addValue('code', code);
  }

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  validator.addValue('idInSite', generatedHash);

  return { generatedHash, validator, hasCode: !!code, itemUrl: '' };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Listing ${request.url}`);

    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    const items = $('ul#vouchers > li > div');

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

    const merchantNameElem = $('div.breadcrumbs span.breadcrumb_last');

    if (!merchantNameElem) {
      logger.error('Unable to find merchant name element');
      return;
    }

    const merchantName = merchantNameElem.text().trim();

    const merchantDomainTag = $('#shopinfo-3 .email');

    if (!merchantDomainTag) {
      log.warning(`merchantDomain not found in ${request.url}`);
    }
    const merchantDomain = merchantDomainTag.attr('href')?.split('@')?.[1];

    // Extract items
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      // Extract the voucher title
      const title = $cheerio('h2')?.text()?.trim();

      if (!title) {
        log.warning('Voucher title is missing');
        continue;
      }

      const item = {
        title,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = await processItem(item, $cheerio);

      if (result.hasCode) {
        itemsWithCode[result.generatedHash] = result;
        // Add the generated hash to the list of IDs to check
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

    if (nonExistingIds.length > 0) {
      let currentResult: ItemResult;

      for (const id of nonExistingIds) {
        currentResult = itemsWithCode[id];
        // Enqueue the coupon URL for further processing with appropriate label and validator data
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
