import cheerio from 'cheerio';
import { createCheerioRouter, KeyValueStore } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

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
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;

  const validator = new DataValidator();

  if (!isExpired) {
    const elementClass = $coupon('*').first().attr('class');
    if (!elementClass) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Element class is missing');
    }

    if (
      elementClass.includes('type-code') ||
      elementClass.includes('type-promo')
    ) {
      hasCode =
        elementClass.includes('type-code') &&
        !elementClass.includes('type-promo');
    } else {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error(
        'Element class doesn\'t contain "type-code" or "type-promo"'
      );
    }

    const idInSite = $coupon('*').first().attr('data-offer-id');
    if (!idInSite) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Element data-offer-id attr is missing');
    }

    // Extract the voucher title
    const titleElement = $coupon('div.of__content > h3').first();
    if (titleElement.length === 0) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Voucher title is missing');
    }
    const voucherTitle = he.decode(titleElement.text().trim());

    // Extract the description
    let description = '';
    const descElement = $coupon('div.of__content').first();
    if (descElement.length > 0) {
      description = he
        .decode(descElement.text())
        .replace(voucherTitle, '') // remove the title from the descriptions
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
    }

    // Add required and optional values to the validator
    validator.addValue('sourceUrl', sourceUrl);
    validator.addValue('merchantName', merchantName);
    validator.addValue('title', voucherTitle);
    validator.addValue('idInSite', idInSite);
    validator.addValue('description', description);
    validator.addValue('isExpired', isExpired);
    validator.addValue('isShown', true);

    let couponUrl = '';
    if (hasCode) {
      // Extract country code from the URL with RegEx
      const countryCode = extractCountryCode(sourceUrl);
      couponUrl = `https://s.picodi.com/${countryCode}/api/offers/${idInSite}/v2`;
    }
    const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

    return { generatedHash, hasCode, couponUrl, validator };
  }
  return { generatedHash: '', hasCode, couponUrl: '', validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, body } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Define a regex pattern to extract the shop name from the HTML content
    const shopNamePattern = /shopName\s*=\s*'([^']+)'/;

    const match = htmlContent.match(shopNamePattern);

    const merchantName = he.decode(match && match[1] ? match[1] : '');

    // Check if valid page
    if (!merchantName) {
      console.log(`Not Merchant URL: ${request.url}`);
    } else {
      // Extract valid coupons
      const validCoupons = $(
        'section.card-offers > ul > li.type-promo, section.card-offers > ul > li.type-code'
      );
      const couponsWithCode: any = {};
      const idsToCheck: string[] = [];
      let result: CouponItemResult = {} as any;
      for (let i = 0; i < validCoupons.length; i++) {
        const element = validCoupons[i];
        result = processCouponItem(merchantName, false, element, request.url);
        if (!result.hasCode) {
          await processAndStoreData(result.validator);
        } else {
          couponsWithCode[result.generatedHash] = requestForCouponWithCode(
            result
          );
          couponsWithCode[result.generatedHash].userData.sourceUrl =
            request.url;
          idsToCheck.push(result.generatedHash);
        }
      }
      // We don't extract expired coupons, because they don't have id and we cannot match them with the ones in the DB
      // const expiredCoupons = $('section.archive-offers > article');
      // for (let i = 0; i < expiredCoupons.length; i++) {
      //   const element = expiredCoupons[i];
      //   await processCouponItem(
      //     crawler.requestQueue,
      //     merchantName,
      //     true,
      //     element,
      //     request.url
      //   );
      // }
      // Call the API to check if the coupon exists
      // const nonExistingIds = await checkCouponIds(idsToCheck);

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

      console.log(`Handled requests count: ${queue.handledCount()}`);

      // Queue the requests for the coupons with codes
      console.log(`Queuing ${Object.keys(mergedRequests).length} requests`);

      // Check if the queue is finished
      const isQueueFinished = await queue.fetchNextRequest();
      if (isQueueFinished === null) {
        console.log('Queue is finished');
        // mergedRequests keys as an array of strings
        const keys = Object.keys(mergedRequests);
        const nonExistingIds = await checkCouponIds(keys);
        console.log('Non-existing IDs count:', nonExistingIds.length);

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
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body } = context;

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
        console.log(`Found code: ${code}\n    at: ${request.url}`);
        validator.addValue('code', code);
      }
    }

    // Process and store the data
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
