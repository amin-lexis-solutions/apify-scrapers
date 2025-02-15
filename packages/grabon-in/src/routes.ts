import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerioElement: cheerio.Root) {
  const elementDataType = $cheerioElement('*').first().attr('data-type');

  if (!elementDataType) {
    log.warning('Element data-type is missing');
  }

  const hasCode = elementDataType === 'cp';

  const code = $cheerioElement('span.visible-lg')?.first()?.text()?.trim();

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', item.description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  hasCode ? validator.addValue('code', code) : null;

  return { validator, hasCode, itemUrl: '' };
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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    // Extract valid coupons
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*').first().attr('data-cid');

      if (!idInSite) {
        logger.error(`idInSite not found in item ${request.url}`);
        return;
      }

      // Extract the voucher title
      const title = $cheerio('div.gcbr > p').first()?.text().trim();

      if (!title) {
        logger.error(`title not found in item ${request.url}`);
        return;
      }

      const description = $cheerio('*')
        .find('.gcb-det')
        ?.text()
        ?.replace(/[ \t]+/g, ' ') // Replace multiple whitespace characters with a single space
        ?.replace(/\n+/g, '\n');

      const item = {
        title,
        idInSite,
        merchantName,
        description,
        sourceUrl: request.url,
      };

      result = await processItem(item, $cheerio);

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
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
