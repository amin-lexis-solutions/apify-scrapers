import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  getMerchantDomainFromUrl,
  ItemHashMap,
  ItemResult,
  generateHash,
  checkItemsIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  const elementClass = $cheerio('*').first().attr('class');

  const isExpired = !!elementClass?.includes('expired');

  const elemCode = $cheerio('div span.btn-peel__secret').first();

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', item.description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  const code = elemCode?.text()?.trim();

  const hasCode = code.length > 0;

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
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.warning(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const items = $('div.promotion-list__promotions > div');

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

    const merchantLink = $(
      'ol.breadcrumb > li:last-child > a.breadcrumb-item__link'
    );

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      logger.error('Merchant name is missing');
      return;
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('Domain is missing');
    }

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const idInSite = $cheerio('*')
        .attr('data-promotion-modal-link')
        ?.match(/\d+$/)?.[0];

      if (!idInSite) {
        log.warning(`Element data-promotion-id attr is missing in item`);
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('h3')?.first()?.text()?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const description = $cheerio(
        `#promotion-details-pane-${idInSite}`
      )?.text();

      const itemData = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
        description,
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
