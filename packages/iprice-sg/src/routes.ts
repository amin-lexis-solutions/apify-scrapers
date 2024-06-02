import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  formatDateTime,
  logError,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

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

function buildCouponUrl(sourceUrl: string, onclickAttr?: string): string {
  // Extract the URL and parameters from the onclick attribute
  const regex = /openPopup\('.*?','(.*?)'\)/;
  const matches = onclickAttr?.match(regex);

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
  couponItem: any,
  $cheerio: cheerio.Root
): CouponItemResult {
  const elementClass = $cheerio('*').first().attr('class');

  if (!elementClass) {
    log.warning('Element class is missing');
  }

  const hasCode = !!elementClass?.includes('code');

  const clickUrlElement = $cheerio('div.dF');

  const isExpired = !!clickUrlElement.attr('onclick')?.includes('expired');

  if (clickUrlElement.length === 0) {
    log.warning('Click URL element is missing');
  }

  const onclick = clickUrlElement.attr('onclick');

  if (!onclick) {
    log.warning('Click URL onclick attr is missing');
  }

  // Build the coupon URL
  const couponUrl = buildCouponUrl(couponItem.sourceUrl, onclick);

  // Extract the coupon ID from the URL
  const idInSite = extractIdFromUrl(couponUrl);

  // Extract the description
  let expiryDateTxt: string | null = null;
  const descElement = $cheerio('div.c-details > div.hidden-details');
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
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  expiryDateTxt
    ? validator.addValue('expiryDateAt', formatDateTime(expiryDateTxt))
    : null;

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

  console.log(couponUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Check if valid page
    if (!$('div#coupon-header img.ek').length) {
      logError(`Not Merchant URL: ${request.url}`);
      return;
    }

    const merchantLogoImg = $('div#coupon-header img.ek');

    const merchantName = merchantLogoImg?.attr('alt')?.trim();

    if (!merchantLogoImg) {
      logError('Unable to find merchant name');
      return;
    }

    const merchantUrl = merchantLogoImg?.attr('srcset')?.trim();

    const merchantDomain = merchantUrl
      ? extractDomainFromImageUrl(merchantUrl)
      : null;

    if (!merchantDomain) {
      logError(`merchantDomain not found ${request.url}`);
      return;
    }

    // Extract valid coupons
    const validCoupons = $(
      'section#store-active-coupon > div:not([class^=nocode])[class*=code], section#store-active-coupon > div[class*=nocode]'
    );
    // Extract expired coupons
    const expiredCoupons = $(
      'section.wb.y > div:not([class^=nocode])[class*=code], section.wb.y > div[class*=nocode]'
    );

    const items = [...validCoupons, ...expiredCoupons];

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: items,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult | undefined;

    for (const item of items) {
      const $coupon = cheerio.load(item);
      // Extract the voucher title
      const title = $coupon('p').first()?.text()?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const couponItem = {
        title,
        merchantDomain,
        merchantName,
        sourceUrl: request.url,
      };

      result = processCouponItem(couponItem, $coupon);

      if (result.hasCode) {
        couponsWithCode[result.generatedHash] = result;
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

    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

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
  const { request, $, log } = context;

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
      log.warning('Coupon code span is missing');
    }

    const code = codeSpan.text().trim();

    // Check if the code is found
    if (!code) {
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
