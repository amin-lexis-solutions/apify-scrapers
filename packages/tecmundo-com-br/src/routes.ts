import { createCheerioRouter, log } from 'crawlee';
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
  getDomainName,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  domain: string | null,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;

  const isExpired = false;

  const elementType = $coupon('*').first().attr('data-coupon-type');
  if (!elementType) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  hasCode = elementType.includes('coupon');

  const idInSite = $coupon('*').first().attr('data-coupon-id');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-promotion-id attr is missing');
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
  const descElement = $coupon('div.coupon__description').first();
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
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  let couponUrl = '';
  if (hasCode) {
    couponUrl = `https://www.tecmundo.com.br/cupons/modals/coupon_clickout?id=${idInSite}`;
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

    const merchantLink = $('div.card-shop-header a[data-shop]');

    if (merchantLink.length === 0) {
      throw new Error('Merchant link is missing');
    }

    const merchantName = merchantLink.attr('data-shop');

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    const domain = getDomainName(request.url);

    if (!domain) {
      log.warning('domain name is missing');
    }
    // Extract valid coupons
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    const validCoupons = $('div.coupons__list > div.coupons__item');

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    for (let i = 0; i < validCoupons.length; i++) {
      const element = validCoupons[i];
      result = processCouponItem(merchantName, element, domain, request.url);
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
    const codeSpan = $('span[data-coupon-code]');
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
