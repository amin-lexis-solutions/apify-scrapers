import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import { ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

async function processItem(item: any, $cheerio: cheerio.Root) {
  function getDescription() {
    let description;
    const descElement = $cheerio('.coupon-meta p');
    if (descElement) {
      description = descElement.text();
    }
    return description;
  }

  function getCode() {
    let code;
    const codeElement = $cheerio('.showcode .coupon-code');
    if (codeElement) {
      code = codeElement.text();
    }
    return code;
  }

  function couponExpired() {
    let expired = false;
    const isExpiredElement = $cheerio('.coupon-bottom').first().text();
    if (isExpiredElement) {
      expired = !isExpiredElement.includes('Giltig till: Tills vidare');
    }
    return expired;
  }

  const code = getCode();
  const description = getDescription();
  const isExpired = couponExpired();

  const validator = new DataValidator();

  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  return { validator, hasCode: !!code, itemUrl: '' };
}
router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    log.info(`Processing URL: ${request.url}`);

    const items = $('.coupon-list .coupon-wrapper');

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

    const merchantElement = $('.bread .breadcrumb .active');

    if (!merchantElement) {
      logger.error(`merchant name tag not found ${request.url}`);
      return;
    }

    const merchantName = merchantElement.text()?.split('rabattkoder')[0];

    const merchantDomainElement = $(`p:contains("${merchantName}.")`);

    if (!merchantDomainElement) {
      log.warning(`not merchantDomain found in sourceUrl ${request.url}`);
    }

    const merchantDomain = merchantDomainElement
      .text()
      ?.match(/([a-zA-Z0-9]+)\.([a-z]+)/)?.[0];

    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const title = $cheerio('.coupon-meta h3')?.text();

      if (!title) {
        logger.error(`title not found in item`);
        continue;
      }

      const idInSite = $cheerio('.modal')?.attr('id')?.split('_id_')?.[1];

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const item = {
        title,
        idInSite,
        merchantDomain,
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
