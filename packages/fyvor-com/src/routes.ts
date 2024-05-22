import cheerio from 'cheerio';
import * as he from 'he';
import * as buffer from 'buffer';
import { createCheerioRouter } from 'crawlee';
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
  domain: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  const idAttr = $coupon('*').first().attr('id')?.trim();
  if (!idAttr) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element ID attr is missing');
  }

  // Extract the ID from the ID attribute
  const idInSite = idAttr.split('_').pop();

  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('ID in site is missing');
  }

  const dataType = $coupon('*').first().attr('data-type')?.trim();
  if (!dataType) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-type attr is missing');
  }

  let hasCode = false;
  let couponUrl = '';
  if (dataType === 'code') {
    hasCode = true;
    couponUrl = `${sourceUrl}?promoid=${idInSite}`;
  }

  // Extract the voucher title
  const titleElement = $coupon('div.coupon_word > a.coupon_title').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  const descElement = $coupon('*[itemprop="description"]');
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
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    const merchantLink = $('div.page_link_n > div > span');

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    const domain = getDomainName(request.url);

    if (!domain) {
      throw new Error('Domain is missing');
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    // Extract valid coupons
    const validCoupons = $('div.c_list:not(.expired) > div[itemprop="offers"]');

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

    // Extract expired coupons
    const expiredCoupons = $('div.c_list.expired > div[itemprop="offers"]');
    for (let i = 0; i < expiredCoupons.length; i++) {
      const element = expiredCoupons[i];
      result = processCouponItem(
        merchantName,
        domain,
        true,
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
          headers: CUSTOM_HEADERS,
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

    const NodeSuffix = 'p';
    const regex = /\s+xxh_([^"]+)/;
    const keys = ['f', 's', 't'];
    const classValues: string[] = [];

    // Class names of these 3 elements are needed to extract the coupon code encrypted parts
    for (const key of keys) {
      const classValue = $(`#${key}${NodeSuffix}`)
        .first()
        .attr('class')
        ?.trim();
      if (!classValue) {
        throw new Error(`Coupon code part ${key} class attr is missing`);
      }
      classValues.push(classValue);
    }

    // Extract the coupon code encrypted parts
    const parts: string[] = [];
    let i = 0;
    for (const classValue of classValues) {
      const part = classValue.match(regex);
      if (!part || !part[1]) {
        throw new Error(`Coupon code part ${keys[i]} is missing`);
      }
      parts.push(part[1]);
      i++;
    }

    const encodedString = parts.join('');

    // Decode the coupon code twice

    // First decode
    const intermediateString = buffer.Buffer.from(
      encodedString,
      'base64'
    ).toString('ascii');

    // Second decode
    const code = buffer.Buffer.from(intermediateString, 'base64').toString(
      'ascii'
    );

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
