import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { ItemResult, getMerchantDomainFromUrl } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  const elemCode = $cheerio('span.code').first();

  const hasCode = !!elemCode;

  // Extract the voucher description
  let description = '';
  const descrElement = $cheerio('div.details > div.idetails').first();
  if (descrElement.length !== 0) {
    description = he.decode(descrElement.text().trim());
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('description', description);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const code = elemCode?.text()?.trim();
  hasCode ? validator.addValue('code', code) : null;

  return { validator, hasCode, itemUrl: '' };
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

    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const items = $('div#divMerchantOffers > div[data-id]');

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

    const merchantElem = $('ol.breadcrumb > li.active').first();

    const merchantName = he.decode(
      merchantElem ? merchantElem.text().trim() : ''
    );

    if (!merchantName) {
      logger.error('Merchant name is missing');
      return;
    }

    const merchantUrl = $('.contact .mail a')
      .attr('href')
      ?.replace('mailto:', '');

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    if (!merchantDomain) {
      log.warning('merchantDomain name is missing');
    }

    let result: ItemResult;

    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      // Retrieve 'data-id' attribute
      const idInSite = $cheerioElement
        .root()
        ?.children()
        ?.first()
        ?.attr('data-id');

      // Check if 'data-id' is set and not empty
      if (!idInSite) {
        logger.error('empty data-id attribute in item');
        continue;
      }

      // Extract the voucher title
      const title = $cheerioElement('div.details > h3').first()?.text()?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = await processItem(itemData, $cheerioElement);

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
