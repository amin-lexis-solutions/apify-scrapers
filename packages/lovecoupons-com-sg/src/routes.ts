import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  getMerchantDomainFromUrl,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

function extractAllText(elem: cheerio.Cheerio): string {
  let text = '';
  if (elem.length > 0) {
    text = he
      .decode(elem.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  return text.trim();
}

function processCouponItem(
  merchantName: string,
  domain: string | null,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  const attrDataType = $coupon('*').first().attr('data-type');
  if (!attrDataType) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Attr data-type is missing');
  }

  let hasCode = false;
  if (attrDataType === '2') {
    hasCode = true;
  }

  const attrDataId = $coupon('*').first().attr('data-id');
  if (!attrDataId) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Attr data-id is missing');
  }

  const idInSite = attrDataId.trim();

  let couponUrl = '';
  if (hasCode) {
    const attrDataOut = $coupon('*').first().attr('data-out');
    if (!attrDataOut) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Attr data-out is missing');
    }
    couponUrl = new URL(attrDataOut.trim(), sourceUrl).href.replace(
      '/go/2/',
      '/go/3/'
    );
  }

  // Extract the voucher title
  const titleElement = $coupon('.Offer h3.Outlink').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = extractAllText(titleElement);

  if (!voucherTitle) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is empty');
  }

  // Extract the description
  const descrElement = $coupon('article header > p').first();
  const description = extractAllText(descrElement);

  // Extract terms and conditions
  const tocElement = $coupon('div.TermsConditions').first();
  const toc = extractAllText(tocElement);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('termsAndConditions', toc);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

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

    const merchantLI = $('ul.c-breadcrumbs > li:last-child');

    const merchantName = he.decode(merchantLI ? merchantLI.text().trim() : '');

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    const domainSpan = $('p.BrandUrl > span');

    const domainUrl = he.decode(domainSpan ? domainSpan.text().trim() : '');

    if (!domainUrl) {
      throw new Error('Merchant name is missing');
    }

    const domain = getMerchantDomainFromUrl(domainUrl);

    // Extract valid coupons
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    const validCoupons = $('div.BrandOffers > article');

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    for (let i = 0; i < validCoupons.length; i++) {
      const element = validCoupons[i];
      result = processCouponItem(
        merchantName,
        domain,
        false,
        element,
        request.url
      );
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
    const codeInput = $('div.RevealCoupon > input');
    if (codeInput.length === 0) {
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
