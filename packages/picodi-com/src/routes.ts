import cheerio from 'cheerio';
import { createCheerioRouter, KeyValueStore } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  logError,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  Origin: 'https://www.picodi.com',
};

function requestForCouponWithCode(item: CouponItemResult) {
  return {
    url: item.couponUrl,
    userData: {
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

function processCouponItem(
  couponItem: any,
  $cheerio: cheerio.Root
): CouponItemResult {
  const elementClass = $cheerio('*').first().attr('class');

  const hasCode = !!elementClass?.includes('type-code');

  // Extract the description
  let description = '';
  const descElement = $cheerio('div.of__content').first();
  if (descElement.length > 0) {
    description = he
      .decode(descElement.text())
      .replace(couponItem.title, '') // remove the title from the descriptions
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const countryCode = extractCountryCode(couponItem.sourceUrl);

  const couponUrl = hasCode
    ? `https://s.picodi.com/${countryCode}/api/offers/${couponItem.idInSite}/v2`
    : '';

  console.log(hasCode, couponUrl);

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, body, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Listing ${request.url}`);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Define a regex pattern to extract the shop name from the HTML content
    const shopNamePattern = /shopName\s*=\s*'([^']+)'/;

    const match = htmlContent.match(shopNamePattern);

    const merchantName = he.decode(match && match[1] ? match[1] : '');

    if (!merchantName) {
      logError(`Not Merchant Name found ${request.url}`);
      return;
    }

    // Extract valid coupons
    const validCoupons = $(
      'section.card-offers > ul > li.type-promo, section.card-offers > ul > li.type-code'
    );

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: validCoupons,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    const couponsWithCode: any = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of validCoupons) {
      const $coupon = cheerio.load(item);

      const idInSite = $coupon('*').first().attr('data-offer-id');

      if (!idInSite) {
        logError('not idInSite found in item');
        continue;
      }

      // Extract the voucher title
      const title = $coupon('div.of__content > h3')?.first()?.text()?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
        sourceUrl: request.url,
      };

      result = processCouponItem(couponItem, $coupon);

      if (result.hasCode) {
        couponsWithCode[result.generatedHash] = requestForCouponWithCode(
          result
        );
        couponsWithCode[result.generatedHash].userData.sourceUrl = request.url;
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

    // Open a named key-value store
    const store = await KeyValueStore.open('coupons');

    const couponsWithCodes = await store.getValue('coupons');

    // convert unknown type to object
    const existingRequests = couponsWithCodes || {};

    // merge the new requests with the existing ones
    const mergedRequests = {
      ...existingRequests,
      ...couponsWithCode,
    };

    await store.setValue('coupons', mergedRequests);

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
      const nonExistingIds = await checkCouponIds(keys);
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
