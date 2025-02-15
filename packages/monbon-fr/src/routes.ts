import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { getMerchantDomainFromUrl, ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  let hasCode = false;

  let isExpired: boolean | undefined = false;

  const elementClass = $cheerio('*').first().attr('class');

  if (!elementClass) {
    log.warning('Element class is missing');
  }

  isExpired = elementClass?.includes('expire-offer');

  const elemCode = $cheerio('div[data-code]').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  // Extract the voucher terms and conditions
  let termsAndConditions;
  const termsElement = $cheerio('div[data-offer=conditions]').first();
  if (termsElement.length !== 0) {
    termsAndConditions = he.decode(termsElement.text().trim());
  } else {
    termsAndConditions = null;
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', termsAndConditions);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  const code = elemCode?.attr('data-code');

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
    log.warning(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const items = $('div.offer-list-item');

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

    const pageH1Elem = $('h1.shop-page-title');

    const merchantName = he.decode(
      pageH1Elem ? pageH1Elem.text().replace('Codes promo ', '').trim() : ''
    );

    if (!merchantName) {
      logger.error(`Merchant name not found in sourceUrl ${request.url}`);
      return;
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('merchantDomain is missing');
    }

    // Extract valid coupons
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*').first().attr('data-id');

      if (!idInSite) {
        logger.error(`Element data-id attr is missing in ${request.url}`);
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('div.h3 > a').first()?.text()?.trim();

      if (!title) {
        logger.error('Voucher title is missing');
        continue;
      }

      const description = $cheerio(
        '.offer-list-item-description.is-hidden'
      ).text();

      const item = {
        title,
        idInSite,
        merchantDomain,
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
