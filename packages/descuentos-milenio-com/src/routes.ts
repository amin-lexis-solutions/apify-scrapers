import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { ItemResult, getMerchantDomainFromUrl } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerioElement: cheerio.Root) {
  // Extract the description
  const description = $cheerioElement('div.card-primary__description')?.text();

  // Extract the code
  const code = $cheerioElement('p.code')?.text();

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', null);
  validator.addValue('description', description);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  return { validator, itemUrl: '', hasCode: !!code };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Processing URL: ${request.url}`);

    // Refactor to use a loop for valid coupons
    const currentItems = $('.brand-index_content-main li div.card-primary');

    const expiredItems = $(
      '.main-section_discounts li.saturate-0 div.card-primary'
    );
    expiredItems.addClass('expired'); // explicity added expired class

    const items = [...currentItems, ...expiredItems];

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

    let merchantName = $(
      'section.brand-index_content-heading-block a img'
    ).attr('title');

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const merchantUrl = $(`.brand-index_content-sidebar a`)
      ?.first()
      ?.attr(`href`);

    if (!merchantUrl) {
      logger.error(`Merchant domain not found ${request.url}`);
      return;
    }

    const merchantDomain = merchantUrl.includes('.')
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    if (!merchantDomain) {
      log.warning('merchantDomain not found');
    }

    merchantName = merchantName?.replace('Descuentos', '')?.trim();

    // Extract valid coupons
    let result: ItemResult;

    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      const title = $cheerioElement('div.card-primary__title')
        ?.first()
        ?.text()
        ?.trim();

      if (!title || title.length == 0) {
        logger.error('title not found in item');
        continue;
      }

      const isExpired = $cheerioElement('*')?.hasClass('expired');

      const itemData = {
        title,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
        isExpired,
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

export { router };
