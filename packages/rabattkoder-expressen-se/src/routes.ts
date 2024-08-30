import { createCheerioRouter, log } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import { ItemResult, generateHash } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

async function processItem(item: any, $cheerio: cheerio.Root) {
  const elementClass = $cheerio('*').first().attr('class');

  const isExpired = elementClass?.includes('expired');

  // Description
  let description;
  const descElement = $cheerio('.text-expand__text').first();

  if (descElement) {
    description = descElement.attr('data-load');
  }

  const validator = new DataValidator();
  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  const code = $cheerio('.voucher-button__code')?.text();

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, validator, hasCode: !!code, itemUrl: '' };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  function getMerchantName() {
    // Select the merchant logo element
    const $merchantLogo = $('.store__logo img');

    // Check if the merchant logo element exists
    if ($merchantLogo.length === 0) {
      return null; // No merchant name found
    }

    // Extract merchant name from the alt attribute
    const altText = $merchantLogo.attr('alt');
    const merchantName = altText?.split('rabattkod')[0]?.trim() ?? null;

    return merchantName;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const items = $('.voucher__list > div.voucher');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
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

    const merchantName = getMerchantName();

    if (!merchantName) {
      logger.error(`Unable to find merchant name element ${request.url}`);
      return;
    }

    const merchantEmailTag = $('p:contains("info@")');

    if (!merchantEmailTag) {
      log.warning(`merchantDomain not found ${request.url}`);
    }

    const merchantDomain = merchantEmailTag
      ?.text()
      ?.match(/([a-zA-Z0-9]+)\.([a-z]+)/)?.[0];

    let result: ItemResult;
    // Extract valid coupons
    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const title = $cheerio('h3.voucher__heading').first()?.text()?.trim();

      if (!title) {
        logger.error(`titleElement not found in item`);
        continue;
      }

      const idInSite = $cheerio('.voucher__btn ').first().attr('data-id');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const itemData = {
        title,
        merchantName,
        idInSite,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = await processItem(itemData, $cheerio);

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
