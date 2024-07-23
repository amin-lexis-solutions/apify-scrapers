import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import {
  checkItemsIds,
  ItemHashMap,
  ItemResult,
  generateHash,
  logError,
} from 'shared/helpers';
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

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, validator, hasCode: !!code, itemUrl: '' };
}
router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
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
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    const merchantElement = $('.bread .breadcrumb .active');

    if (!merchantElement) {
      logError(`merchant name tag not found ${request.url}`);
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

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const title = $cheerio('.coupon-meta h3')?.text();

      if (!title) {
        logError(`title not found in item`);
        continue;
      }

      const idInSite = $cheerio('.modal')?.attr('id')?.split('_id_')?.[1];

      if (!idInSite) {
        logError('idInSite not found in item');
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

      if (result.hasCode) {
        itemsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
        continue;
      }

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
        logError(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkItemsIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;

    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
      await postProcess(
        {
          SaveDataHandler: {
            validator: currentResult.validator,
          },
        },
        context
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
