import cheerio from 'cheerio';
import * as he from 'he';
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

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  'X-Requested-With': 'XMLHttpRequest',
};

function processCouponItem(
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  domain: string | null,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  const configAttr = $coupon('*').first().attr('data-voucher-config-value');
  if (!configAttr) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Attribute data-voucher-config-value is missing');
  }

  const config = JSON.parse(configAttr);

  // Extract the voucher id
  const idInSite = config.id.toString();

  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('ID in site is missing');
  }

  const hasCode = config.type === 1;
  let couponUrl = '';
  if (hasCode) {
    // Extract domain from the source URL by parsing the URL
    const sourceUrlObj = new URL(sourceUrl);
    const sourceDomain = sourceUrlObj.hostname;
    couponUrl = `https://${sourceDomain}/async/voucher-modal?id=${idInSite}`;
  }

  // Extract the voucher title
  const titleElement = $coupon('span.voucherCard-hubTitleTextMain').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  let description = '';
  const descElement = $coupon('ul.voucherCard-details').first();
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

    const merchantLogoImgSelector = 'div.shopHeader img.shopLogo';

    // Check if valid page
    if (!$(merchantLogoImgSelector).length) {
      console.log(`Not Merchant URL: ${request.url}`);
      return;
    }
    const merchantLogoImg = $(merchantLogoImgSelector);
    let merchantName = '';
    if (merchantLogoImg.length > 0) {
      merchantName = merchantLogoImg.attr('title')?.trim() || '';
    }

    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }

    const domain = getDomainName(request.url);

    if (!domain) {
      log.warning('domain name is missing');
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    // Extract valid coupons
    const validCoupons = $(
      'div.voucherGroup div.voucherCard:not(.voucherCard--expired)'
    );

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      log.error(`Coupons anomaly detected - ${request.url}`);
      return;
    }

    for (const element of validCoupons) {
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
      'div.voucherGroup div.voucherCard.voucherCard--expired'
    );
    for (const element of expiredCoupons) {
      result = processCouponItem(
        merchantName,
        true,
        element,
        null,
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

    if (nonExistingIds.length <= 0) {
      return;
    }
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
          headers: CUSTOM_HEADERS_LOCAL,
        },
        { forefront: true }
      );
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

    const codeElement = $('span[data-voucher-modal-target="code"]');
    if (!codeElement) {
      throw new Error(
        `Unable to find code element in the page: ${request.url}`
      );
    }
    const code = codeElement.text().trim();

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
