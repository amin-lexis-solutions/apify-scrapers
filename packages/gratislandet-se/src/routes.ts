import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  const code = $cheerio('*').first().attr('data-code')?.trim();

  const hasCode = !!code;

  // Extract the description
  let description = '';
  let descElement = $cheerio('div.offerbox-store-title div.longtext').first();

  if (descElement.length === 0) {
    descElement = $cheerio(
      'div.offerbox-store-title span.slutdatum:last-child'
    ).first();
  }

  if (descElement.length > 0) {
    description = he.decode(descElement.text()).trim();
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

    // Extract valid coupons
    const items = $('div.active-offers-container div.offerbox-store');

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
      'ol.breadcrumb > li:last-child > a > span[itemprop=name]'
    ).first();

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      logger.error('Merchant name is missing');
      return;
    }

    // Extract valid coupons
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*').first().attr('data-offerid');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        return;
      }

      // Extract the voucher title
      const title = $cheerio('div.offerbox-store-title > p')
        ?.first()
        ?.text()
        .trim();

      if (!title) {
        logger.error('titleElement not found in item');
        return;
      }

      const item = {
        title,
        idInSite,
        merchantName,
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
