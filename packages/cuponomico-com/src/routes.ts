import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { sleep, generateItemId, ItemResult } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any, $cheerioElement: cheerio.Root): ItemResult {
  // verify coupon code
  const hasCode = !!$cheerioElement('a.coupon')
    ?.text()
    ?.toLocaleLowerCase()
    ?.includes('ver cupón');

  // Extract the description
  let description = '';
  const descElement = $cheerioElement('div.trav-list-bod > p').first();
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
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, hasCode, itemUrl: item.itemUrl, validator };
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
    log.info(`\nProcessing URL: ${request.url}`);

    const items = $(
      'div.hot-page2-alp-con-right-1 > div.row > div.hot-page2-alp-r-list'
    );

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

    const elementH2 = $('div.hot-page2-alp-con-left-1 > h2');

    const merchantName = he.decode(elementH2?.text()?.trim());

    if (!merchantName) {
      logger.error('Merchant name is missing');
      return;
    }

    // Extract valid coupons
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const title = $cheerio('h3').first().text().trim();

      if (!title) {
        logger.error(`title not found in item`);
        continue;
      }

      const linkElement = $cheerio('a.coupon');

      // Extract both 'store-url' and 'coupon-url' attributes
      const itemUrl = linkElement.attr('coupon-url') || '';
      // Define the regex pattern
      const regex = /[?&]cupon=(\d+)/;

      // Attempt to match both URLs against the regex
      const idInSite = itemUrl?.match(regex)?.[1];

      if (!idInSite) {
        logger.error(`idInSite not found in item`);
        continue;
      }

      const itemData = {
        title,
        merchantName,
        idInSite,
        sourceUrl: request.url,
        itemUrl,
      };

      result = processItem(itemData, $cheerio);

      if (result.hasCode) {
        if (!result.itemUrl) continue;

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

        log.info(`Enqueued code request for ${result.itemUrl}`);
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

// TODO: Review this handler to not working properly
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

    // Extract the coupon code
    const codeInput = $('div#dialog input.txtCode');

    if (codeInput.length === 0) {
      log.warning('Coupon code input is missing');
    }

    const code = codeInput.val().trim();

    // Check if the code is found
    if (!code) {
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
