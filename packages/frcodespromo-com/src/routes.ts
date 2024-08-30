import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { ItemResult, generateHash } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerioElement: cheerio.Root) {
  const elemCode = $cheerioElement('span.coupon_code').first();

  const code = elemCode ? elemCode.html() : null;

  const hasCode = !!code;

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('description', item.description);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  hasCode ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, validator, itemUrl: '', hasCode };
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
    const items = $('div#coupon_list div.c_list > div[data-type]');

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

    let merchantName = $('a.golink').attr('title');

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    merchantName = merchantName?.trim()?.toLowerCase();

    // Extract valid coupons
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const elementClass = $cheerio('*').first().attr('class');

      if (!elementClass) {
        logger.error('Element class not found in item');
        continue;
      }

      const idInSite = $cheerio('div.coupon_word > a')
        ?.first()
        ?.attr('id')
        ?.split('_')[1];

      if (!idInSite) {
        logger.error(`Element data-id attr is missing in ${request.url}`);
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('div.coupon_title')?.first()?.text()?.trim();

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }

      const description = $cheerio('*')
        .find(`.coupon_word span.cpdesc.less`)
        .text();

      const item = {
        title,
        merchantName,
        idInSite,
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
