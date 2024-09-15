import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import * as he from 'he';
import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { sleep, ItemResult } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any, $cheerio: cheerio.Root): ItemResult {
  let itemUrl = '';
  const elementClass = $cheerio('*').first().attr('class');

  if (!elementClass) {
    log.warning('Element class is missing');
  }

  const hasCode = !!elementClass?.includes('offer-label-type-code');

  if (hasCode) {
    itemUrl = `${item.sourceUrl}?popup_id=${item.idInSite}`;
  }

  // Extract the description
  const descElement = $cheerio('div.voor');
  let description = '';
  if (descElement.length > 0) {
    description = descElement.text().trim();
  }

  // Check if the coupon is exclusive
  let isExclusive = false;
  const exclusiveElement = $cheerio('span.label-exclusive');
  if (exclusiveElement.length > 0) {
    isExclusive = true;
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isShown', true);

  return { hasCode, itemUrl, validator };
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
    const currentItems = $(
      'div.current-shop-offers > div.offer-default.not-expired'
    );
    // Extract expired coupons
    const expiredItems = $(
      'div.current-shop-offers > div.offer-default.has-expired'
    );

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

    const merchantElem = $('ol.mrk-breadcrumbs > li:last-child');

    const merchantName = he.decode(
      merchantElem ? merchantElem.text().trim() : ''
    );

    if (!merchantName) {
      logger.error('Merchant name is missing');
      return;
    }

    let result: ItemResult;

    for (const item of items) {
      const $cheerioElement = cheerio.load(item);

      const isExpired = $cheerioElement('*').hasClass('has-expired');

      const idAttr = $cheerioElement('*').first().attr('id')?.trim();

      if (!idAttr) {
        log.warning('Element ID attr not found in item');
      }

      // Extract the ID from the ID attribute
      const idInSite = idAttr?.split('-')?.pop();

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const title = $cheerioElement('h3 > a').first().text().trim();

      if (!title) {
        logger.error('Voucher title is missing');
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantName,
        isExpired,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerioElement);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        // Add the coupon URL to the request queue
        await crawler.requestQueue.addRequest(
          {
            url: result.itemUrl,
            userData: {
              ...request.userData,
              label: Label.getCode,
              validatorData: result.validator.getData(),
            },
            headers: CUSTOM_HEADERS,
          },
          { forefront: true }
        );
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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, $, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const codeInput = $('div.code-popup > input[type="text"]').first();
    if (!codeInput) {
      log.warning('Coupon code input element is missing');
    }
    const code = codeInput.val()?.trim();

    // Check if the code is found
    if (!code) {
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    try {
      await postProcess(
        {
          SaveDataHandler: { validator },
        },
        context
      );
    } catch (error: any) {
      log.warning(`Post-Processing Error : ${error.message}`);
      return;
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
