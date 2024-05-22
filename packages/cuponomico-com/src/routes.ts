import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;
  let couponUrl = '';

  const link = $coupon('a')
    .filter((i, el) => {
      const linkText = $coupon(el).text().trim();
      return linkText === 'Ver oferta' || linkText === 'Ver cupón';
    })
    .first(); // Use .first() to work with at most one element

  if (link.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Link to the coupon details is missing');
  }

  hasCode = link.text().trim() === 'Ver cupón';

  // Extract both 'store-url' and 'coupon-url' attributes
  const storeUrl = link.attr('store-url');

  if (!storeUrl) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('storeUrl is missing');
  }

  const cpnUrl = link.attr('coupon-url');

  if (!cpnUrl) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('cpnUrl is missing');
  }

  // Define the regex pattern
  const regex = /[?&]cupon=(\d+)/;

  // Attempt to match both URLs against the regex
  const storeUrlMatch = storeUrl.match(regex);
  const cpnUrlMatch = cpnUrl.match(regex);

  // Determine which URL and match to use
  let finalUrl,
    idInSite = '';
  if (storeUrlMatch) {
    finalUrl = storeUrl;
    idInSite = storeUrlMatch[1];
  } else if (cpnUrlMatch) {
    finalUrl = cpnUrl;
    idInSite = cpnUrlMatch[1];
  }

  if (hasCode) {
    couponUrl = finalUrl;
  }

  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('idInSite is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon('h3').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the description
  let description = '';
  const descElement = $coupon('div.trav-list-bod > p').first();
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
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    const elementH2 = $('div.hot-page2-alp-con-left-1 > h2');
    if (elementH2.length === 0) {
      throw new Error('H2 element is missing');
    }

    const merchantName = he.decode(elementH2.text().trim());

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    // Extract valid coupons
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    const validCoupons = $(
      'div.hot-page2-alp-con-right-1 > div.row > div.hot-page2-alp-r-list'
    );

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      log.error(`Coupons anomaly detected - ${request.url}`);
      return;
    }

    for (let i = 0; i < validCoupons.length; i++) {
      const element = validCoupons[i];
      result = processCouponItem(merchantName, element, request.url);
      if (!result.hasCode) {
        await processAndStoreData(result.validator);
      } else {
        couponsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds.length > 0) {
      let currentResult: CouponItemResult;
      for (const id of nonExistingIds) {
        currentResult = couponsWithCode[id];
        // Add the coupon URL to the request queue
        await crawler.requestQueue.addRequest(
          {
            url: currentResult.couponUrl,
            userData: {
              label: Label.getCode,
              validatorData: currentResult.validator.getData(),
            },
            headers: CUSTOM_HEADERS,
          },
          { forefront: true }
        );
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, $ } = context;

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
      console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code input is missing');
    }

    const code = codeInput.val().trim();

    // Check if the code is found
    if (!code) {
      console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code not found in the HTML content');
    }

    console.log(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
