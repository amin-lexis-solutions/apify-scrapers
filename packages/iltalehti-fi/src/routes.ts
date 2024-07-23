import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  getMerchantDomainFromUrl,
  formatDateTime,
  logError,
  generateHash,
  ItemHashMap,
  ItemResult,
  checkItemsIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  const couponAttr = $cheerio('*').first().attr('data-payload');

  const code = couponAttr?.length == 0 ? null : couponAttr?.trim();

  const hasCode = !!code;

  let expiryDateAt = '';
  const timeElement = $cheerio('time').first();

  if (timeElement.length > 0) {
    const datetimeAttr = timeElement.attr('datetime');
    if (datetimeAttr && datetimeAttr.trim() !== '') {
      expiryDateAt = formatDateTime(datetimeAttr);
    }
  }

  // Extract the description
  let description = '';
  const descElement = $cheerio('div.term-collapse > div.inner').first();
  if (descElement.length > 0) {
    description = he
      .decode(descElement.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('expiryDateAt', expiryDateAt);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  hasCode ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, validator, hasCode, itemUrl: '' };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const items = $('div.view-content > div > article');

    try {
      await preProcess(
        {
          // AnomalyCheckHandler: {
          //   items,
          // },
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

    const metaName = $('meta[itemprop="name"]');

    if (metaName.length === 0) {
      log.warning('MerchantElement is missing');
    }

    const merchantName = he.decode(metaName.attr('content') || '');

    if (!merchantName) {
      logError(`Merchant name not found ${request.url}`);
      return;
    }

    // Extract domain from linlk element with itemprop="sameAs"
    const domainLink = $('link[itemprop="sameAs"]')?.attr('content');

    const merchantDomain = domainLink
      ? getMerchantDomainFromUrl(domainLink)
      : null;

    if (!merchantDomain) {
      log.warning(`merchantDomain not found in sourceUrl ${request.url}`);
    }

    // Extract valid coupons
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*').first().attr('id')?.trim().split('-')[1];

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('h3')?.first()?.text()?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const item = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
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
      // Process and store the data
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
