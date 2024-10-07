import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { generateHash, ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = generateHash(item.merchantName, item.title, item.sourceUrl);

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('description', item.description);
  validator.addValue('isShown', true);
  validator.addValue('code', item.code);

  return { hasCode: !!item.code, itemUrl: '', validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const items = $('.container .sim-card');

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

    const merchantName = $('.breadcrumbs .last-item')
      ?.text()
      ?.replace('HK', '')
      ?.trim();

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const merchantDomain = null;

    let result: ItemResult;

    for (const element of items) {
      const title = $(element).find('.card-deal-title').text();

      if (!title) {
        logger.error(`not title found in item`);
        continue;
      }

      const description = $(element)
        .find('.card-deal-categories')
        .last()
        .text();

      const code = $(element)
        .find('.coupon .inner_con')
        .text()
        .replaceAll('*', '');

      const isExpired = $(element).hasClass('expired');

      const itemData = {
        title,
        description,
        code,
        merchantDomain,
        isExpired,
        merchantName,
        sourceUrl: request.url,
      };

      result = processItem(itemData);

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
        log.warning(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
