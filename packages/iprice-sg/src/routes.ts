import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  formatDateTime,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

function extractDomainFromImageUrl(url: string): string {
  // Regular expression to extract the file name without extension
  const regex = /\/([^/]+)\.\w+$/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Replace dashes with dots in the top-level domain part
    return matches[1].replace(/-(?=[^.]*$)/, '.');
  }

  return '';
}

function buildCouponUrl(onclickAttr: string, sourceUrl: string): string {
  // Extract the URL and parameters from the onclick attribute
  const regex = /openPopup\('.*?','(.*?)'\)/;
  const matches = onclickAttr.match(regex);

  if (matches && matches[1]) {
    // Decode the extracted URL
    let extractedUrl = decodeURIComponent(matches[1]);
    // Replace &amp; with &
    extractedUrl = extractedUrl.replace(/&amp;/g, '&');
    // Extract the query parameters
    const queryParamsMatch = extractedUrl.match(/\?(.*)$/);

    if (queryParamsMatch && queryParamsMatch[1]) {
      // Append the query parameters to the sourceUrl
      return `${sourceUrl}?${queryParamsMatch[1]}`;
    }
  }

  return sourceUrl; // Return the sourceUrl if no parameters are found
}

function extractIdFromUrl(url: string): string | null {
  // Regular expression to find the _id parameter
  const regex = /[?&]_id=([^&]+)/;
  const matches = url.match(regex);

  if (matches && matches[1]) {
    return matches[1];
  } else {
    return null; // Return null if _id is not found
  }
}

function processCouponItem(
  merchantName: string,
  domain: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  const elementClass = $coupon('*').first().attr('class');
  if (!elementClass) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  let hasCode = false;
  if (elementClass.includes('nocode') || elementClass.includes('code')) {
    hasCode = elementClass.includes('code') && !elementClass.includes('nocode');
  } else {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class doesn\'t contain "nocode" or "code"');
  }

  const clickUrlElement = $coupon('div.dF');
  if (clickUrlElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Click URL element is missing');
  }

  const onclick = clickUrlElement.attr('onclick');
  if (!onclick) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Click URL onclick attr is missing');
  }

  // Build the coupon URL
  const couponUrl = buildCouponUrl(onclick, sourceUrl);

  // Extract the coupon ID from the URL
  const idInSite = extractIdFromUrl(couponUrl);

  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('ID in site is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon('p').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  let expiryDateTxt: string | null = null;
  const descElement = $coupon('div.c-details > div.hidden-details');
  let description = '';
  if (descElement.length > 0) {
    descElement.find('.hk').each(function (this: cheerio.Cheerio) {
      let key = cheerio(this).children().first().text().trim();
      const value = cheerio(this).children().last().text().trim();

      // Remove trailing colon from the key, if present
      key = key.replace(/:$/, '');

      description += `${key}: ${value}\n`;
    });

    // Use descElement to find the .hk element with 'Validity:'
    const validityItem = descElement
      .find('.hk')
      .filter(function (this: cheerio.Element) {
        return cheerio(this).children().first().text().trim() === 'Validity:';
      })
      .first();

    // Extract the date if the element is found
    if (validityItem.length > 0) {
      expiryDateTxt = validityItem.children().last().text().trim();
    }
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
  if (expiryDateTxt) {
    validator.addValue('expiryDateAt', formatDateTime(expiryDateTxt));
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

    // Check if valid page
    if (!$('div#coupon-header img.ek').length) {
      console.log(`Not Merchant URL: ${request.url}`);
    } else {
      const merchantLogoImg = $('div#coupon-header img.ek');
      let merchantName = '';
      let domain = '';
      if (merchantLogoImg.length > 0) {
        merchantName = merchantLogoImg.attr('alt')?.trim() || '';
        domain = extractDomainFromImageUrl(
          merchantLogoImg.attr('srcset')?.trim() || ''
        );
      }

      if (!merchantName) {
        throw new Error('Unable to find merchant name');
      }

      const couponsWithCode: CouponHashMap = {};
      const idsToCheck: string[] = [];
      let result: CouponItemResult;

      // Extract valid coupons
      const validCoupons = $(
        'section#store-active-coupon > div:not([class^=nocode])[class*=code], section#store-active-coupon > div[class*=nocode]'
      );
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
      const expiredCoupons = $(
        'section.wb.y > div:not([class^=nocode])[class*=code], section.wb.y > div[class*=nocode]'
      );
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
    const codeSpan = $('span#code');
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
