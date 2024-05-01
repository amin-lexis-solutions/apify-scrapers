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
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

function processCouponItem(
  merchantName: string,
  domain: string,
  couponElement: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;

  const elementClass = $coupon('*').first().attr('class');
  if (!elementClass) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  hasCode = elementClass.includes('copy-code');

  const idInSite = $coupon('*').first().attr('id');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element id attr is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon('div.promoblock--title').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he
    .decode(titleElement.text().trim())
    .replace(/\s+/g, ' ');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  let couponUrl = '';
  if (hasCode) {
    couponUrl = `${sourceUrl}/${idInSite}`;
  }

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Initialize variables to hold the extracted information
    let merchantName = '';
    let domain = '';

    $('script[type="application/ld+json"]').each((_, element) => {
      // Attempt to parse the JSON-LD content of each script tag
      try {
        const jsonData = JSON.parse($(element).html() || '');
        // Check if the JSON-LD is of the type 'Store'
        if (jsonData['@type'] === 'Store') {
          merchantName = jsonData.name; // Extract the merchant name

          // Extract the domain, removing 'www.' if present
          const urlObj = new URL(jsonData.url);
          domain = urlObj.hostname.replace(/^www\./, '');

          // Since we found our target, we stop processing further
          return false; // Break out of the .each loop
        }
      } finally {
        // We don't catch so that the error is logged in Sentry, but use finally
        // since we want the Apify actor to end successfully and not waste resources by retrying.
      }
      return true; // Continue processing the next script tag
    });

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    // const domain = getDomainName(request.url);
    if (!domain) {
      throw new Error('Domain is missing');
    }

    // Assuming processCouponItem is an async function
    // Extract valid coupons with non-empty id attributes
    const validCoupons = $('div.flex--container--wrapping > div[id]').filter(
      function (this) {
        const id = $(this).attr('id');
        return id !== undefined && id.trim() !== ''; // Filter out empty or whitespace-only ids
      }
    );

    // Use for...of loop to handle async operations within loop
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    for (const element of validCoupons.toArray()) {
      // Since element is a native DOM element, wrap it with Cheerio to use jQuery-like methods
      result = processCouponItem(merchantName, domain, element, request.url);
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
    const codeSpan = $(`span#codetext-${validatorData.idInSite}`);
    if (codeSpan.length === 0) {
      console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code span is missing');
    }

    const code = codeSpan.text().trim();

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
