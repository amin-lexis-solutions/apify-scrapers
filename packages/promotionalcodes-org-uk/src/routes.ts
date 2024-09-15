import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  const elemCode = $cheerio('div.code').first();

  const hasCode = !!elemCode;

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item?.idInSite || null);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const code = elemCode?.text()?.trim();

  hasCode ? validator.addValue('code', code) : null;

  return { validator, hasCode, itemUrl: '' };
}

export const router = createCheerioRouter();

//TODO: inspect title not found in item error
router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const items = $('div.offers > article').toArray();

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

    const merchantElem = $('span.categories.active').first();

    const merchantName = he.decode(
      merchantElem ? merchantElem.text().trim() : ''
    );

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantDomainElement = $(`meta[name=description]`)?.attr(`content`);
    const merchantDomain = merchantDomainElement?.match(
      /([a-zA-Z0-9]+)\.([a-z]+)/
    )?.[0];

    if (!merchantDomain) {
      log.warning(`merchantDomain not found ${request.url}`);
    }

    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      // Extract the voucher title
      const title = $cheerio('h3')?.first()?.text()?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const item = {
        title,
        merchantName,
        merchantDomain,
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
