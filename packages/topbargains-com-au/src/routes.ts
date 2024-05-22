import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
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
  isExpired: boolean,
  couponElement: cheerio.Element,
  domain: string | null,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  const elementButtonLink = $coupon('div.coupon-cloumn > a').first();

  if (elementButtonLink.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Button link element is missing');
  }

  // Extract idInSite from the data-coupon attribute
  const idInSite = elementButtonLink.attr('data-coupon');

  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('ID in site is missing');
  }

  // innerText of the button link
  const buttonLinkText = elementButtonLink.text().trim();

  let hasCode = false;
  let couponUrl = '';
  // Check if the button link text contains 'View Code'
  if (buttonLinkText.includes('View Code')) {
    hasCode = true;
    couponUrl = sourceUrl + '?view_coupon_code=' + idInSite;
  }

  // Extract the voucher title
  const titleElement = $coupon('h3').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  const descElement = $coupon('div.coupon-body');
  let description = '';
  if (descElement.length > 0) {
    description = descElement.text().trim();
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

    const merchantLogoImgSelector = 'div.store-image.block-center img';

    // Check if valid page
    if (!$(merchantLogoImgSelector).length) {
      console.log(`Not Merchant URL: ${request.url}`);
      return;
    }
    const merchantLogoImg = $(merchantLogoImgSelector);
    let merchantName = '';
    if (merchantLogoImg.length > 0) {
      merchantName = merchantLogoImg.attr('alt')?.trim() || '';
      merchantName = merchantName.replace('promo codes', '').trim();
    }

    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }

    const domainUrlLink = $('.field-content a')?.attr('href') || '';

    if (!domainUrlLink) {
      log.warning('Unable to find domain name');
    }

    const domain = getDomainName(domainUrlLink);

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    // Extract valid coupons
    const validCoupons = $(
      'div.view-coupons-block-store-pages div.main-coupon-wrapper'
    );

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    for (const element of validCoupons) {
      if ($(element).find('div.coupon-cloumn > a[data-coupon]').length === 0) {
        continue;
      }
      result = processCouponItem(
        merchantName,
        false,
        element,
        domain,
        request.url
      );
      if (!result.hasCode) {
        await processAndStoreData(result.validator);
      } else {
        couponsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
      }
    }

    // Extract expired coupons
    const expiredCoupons = $(
      'div.view-expired-coupons-block-store-pages div.main-coupon-wrapper'
    );
    for (const element of expiredCoupons) {
      // Check if div.coupon-cloumn > a[data-coupon] exists in element
      if ($(element).find('div.coupon-cloumn > a[data-coupon]').length === 0) {
        continue;
      }
      result = processCouponItem(
        merchantName,
        true,
        element,
        domain,
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

    const regex = /\\u003Cspan class=\\u0022get-code\\u0022\\u003E([^\\]+)\\u003C\\\/span\\u003E/;

    const match = $.html().match(regex);

    if (!match) {
      throw new Error(`Coupon code span is missing: ${request.url}`);
    }

    const code = match[1];

    // Check if the code is found
    if (!code) {
      throw new Error(
        `Coupon code not found in the HTML content: ${request.url}`
      );
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
