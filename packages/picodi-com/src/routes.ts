import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateItemId,
  checkItemsIds,
  ItemResult,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  Origin: 'https://www.picodi.com',
};

function requestForCouponWithCode(item: ItemResult, request: any) {
  return {
    url: item.itemUrl,
    userData: {
      ...request.userData,
      label: Label.getCode,
      validatorData: item.validator.getData(),
    },
    headers: CUSTOM_HEADERS_LOCAL,
  };
}

function extractCountryCode(url: string): string {
  // Use the URL constructor to parse the given URL
  const parsedUrl = new URL(url);

  // Split the pathname by '/' to get the segments
  const pathSegments = parsedUrl.pathname.split('/');

  // Assuming the country code is always after the first '/' (and not the last element if it's empty)
  // Filter out empty strings to avoid issues with trailing slashes
  const nonEmptySegments = pathSegments.filter((segment) => segment.length > 0);

  // The country code is expected to be the first segment after the domain
  const countryCode = nonEmptySegments[0];

  return countryCode;
}

function processItem(item: any, $cheerio: cheerio.Root): ItemResult {
  const elementClass = $cheerio('*').first().attr('class');

  const hasCode = !!elementClass?.includes('type-code');

  // Extract the description
  let description = '';
  const descElement = $cheerio('div.of__content').first();
  if (descElement.length > 0) {
    description = he
      .decode(descElement.text())
      .replace(item.title, '') // remove the title from the descriptions
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

  const countryCode = extractCountryCode(item.sourceUrl);

  const itemUrl = hasCode
    ? `https://s.picodi.com/${countryCode}/api/offers/${item.idInSite}/v2`
    : '';

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, hasCode, itemUrl, validator };
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

    log.info(`Listing ${request.url}`);

    // Extract valid coupons
    const items = $(
      'section.card-offers > ul > li.type-promo, section.card-offers > ul > li.type-code'
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

    const merchantName =
      $('.sidebar__link').attr('aria-label') ||
      $('.hero-shop__img').attr('alt')?.replace('voucher code', '');

    if (!merchantName) {
      logger.error(`Not Merchant Name found ${request.url}`);
      return;
    }

    const itemsWithCode: any = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const idInSite = $cheerio('*').first().attr('data-offer-id');

      if (!idInSite) {
        logger.error('not idInSite found in item');
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('div.of__content > h3')?.first()?.text()?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerio);

      if (result.hasCode) {
        itemsWithCode[result.generatedHash] = requestForCouponWithCode(
          result,
          request
        );
        itemsWithCode[result.generatedHash].userData.sourceUrl = request.url;
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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }

    // merge the new requests with the existing ones
    const mergedRequests = {
      ...itemsWithCode,
    };

    const queue = crawler.requestQueue;

    log.debug(`Handled requests count: ${queue.handledCount()}`);

    // Queue the requests for the coupons with codes
    log.debug(`Queuing ${Object.keys(mergedRequests).length} requests`);

    // // Check if the queue is finished
    const isQueueFinished = await queue.fetchNextRequest();

    if (isQueueFinished === null) {
      log.debug('Queue is finished');
      // mergedRequests keys as an array of strings
      const keys = Object.keys(mergedRequests);
      const nonExistingIds = await checkItemsIds(keys);
      log.debug(`Non-existing IDs count: ${nonExistingIds.length}`);

      // Filter out the non-existing IDs from the merged requests
      if (nonExistingIds.length > 0) {
        let currentResult: any;
        for (const id of nonExistingIds) {
          currentResult = mergedRequests[id];
          // Add the coupon URL to the request queue
          await crawler.requestQueue.addRequest(currentResult, {
            forefront: true,
          });
        }
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    let code = '';

    // Attempt to parse the HTML content as JSON
    const parsedJson = JSON.parse(htmlContent);

    // Extract the "o_c" value
    if (
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      'o_c' in parsedJson
    ) {
      code = parsedJson['o_c'].trim();
      if (code) {
        const decodedString = Buffer.from(code, 'base64').toString('utf-8');
        code = decodedString.slice(6, -6);
        log.warning(`Found code: ${code}\n    at: ${request.url}`);
        validator.addValue('code', code);
      }
    }

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator: validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
