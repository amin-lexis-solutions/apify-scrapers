import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  getMerchantDomainFromUrl,
  formatDateTime,
  ItemResult,
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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    const metaName = $('meta[itemprop="name"]');

    if (metaName.length === 0) {
      log.warning('MerchantElement is missing');
    }

    const merchantName = he.decode(metaName.attr('content') || '');

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
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
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*').first().attr('id')?.trim().split('-')[1];

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('h3')?.first()?.text()?.trim();

      if (!title) {
        logger.error('title not found in item');
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
