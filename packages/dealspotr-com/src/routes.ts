import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import { sleep, ItemResult } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any, $cheerioElement: cheerio.Root): ItemResult {
  // verify coupon has code
  const hasCode = !!$cheerioElement('*')
    ?.first()
    ?.attr('class')
    ?.includes('copy-code');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('description', item.description);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const itemUrl = hasCode ? `${item.sourceUrl}/${item.idInSite}` : '';

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

    // Extract valid coupons with non-empty id attributes
    const items = $('div.flex--container--wrapping > div[id]')
      .filter(function (this) {
        const id = $(this).attr('id');
        return id !== undefined && id.trim() !== ''; // Filter out empty or whitespace-only ids
      })
      .toArray();

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

    // Use for...of loop to handle async operations within loop
    let result: ItemResult;

    for (const element of items) {
      const $cheerioElement = cheerio.load(element);

      const merchantDomain = $('.flex--container--wrapping .gr8.href').text();

      merchantDomain
        ? log.info(`merchantDomain - ${merchantDomain}`)
        : log.warning(`merchantDomain not found in item- ${request.url}`);

      const merchantName = $(element)
        ?.find('.promoblock--logo img')
        ?.attr('alt')
        ?.replace('Promo Codes', '');

      const idInSite = $cheerioElement('*').first().attr('id');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const title = $cheerioElement('div.promoblock--title')
        .text()
        .trim()
        .replace(/\s+/g, ' ');

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }

      const description = $cheerioElement('div.fs12').text().trim();

      const item = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
        description,
        sourceUrl: request.url,
      };
      // Since element is a native DOM element, wrap it with Cheerio to use jQuery-like methods
      result = processItem(item, $cheerioElement);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        await crawler?.requestQueue?.addRequest(
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

    // Extract the coupon code
    const codeSpan = $(`span#codetext-${validatorData.idInSite}`);

    if (codeSpan.length === 0) {
      log.warning('Coupon code span is missing');
    }

    const code = codeSpan.text().trim();

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
