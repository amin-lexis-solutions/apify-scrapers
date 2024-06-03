import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processCouponItem(
  couponItem: any,
  $coupon: cheerio.Root
): CouponItemResult {
  // verify coupon has code
  const hasCode = !!$coupon('*')?.first()?.attr('class')?.includes('copy-code');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const couponUrl = hasCode
    ? `${couponItem.sourceUrl}/${couponItem.idInSite}`
    : '';

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Initialize variables to hold the extracted information
    let merchantName = '';
    let domain;

    $('script[type="application/ld+json"]').each((_, element) => {
      // Attempt to parse the JSON-LD content of each script tag
      try {
        const jsonData = JSON.parse($(element).html() || '');
        console.log(jsonData);
        // Check if the JSON-LD is of the type 'Store'
        if (jsonData['@type'] === 'Store') {
          merchantName = jsonData.name; // Extract the merchant name

          // Extract the domain, removing 'www.' if present
          domain = getMerchantDomainFromUrl(jsonData.url);

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
      logError('Merchant name is missing');
      return;
    }

    if (!domain) {
      log.warning('Domain is missing');
    }

    // Assuming processCouponItem is an async function
    // Extract valid coupons with non-empty id attributes
    const validCoupons = $('div.flex--container--wrapping > div[id]')
      .filter(function (this) {
        const id = $(this).attr('id');
        return id !== undefined && id.trim() !== ''; // Filter out empty or whitespace-only ids
      })
      .toArray();

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: validCoupons,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    // Use for...of loop to handle async operations within loop
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const element of validCoupons) {
      const $coupon = cheerio.load(element);
      const idInSite = $coupon('*').first().attr('id');

      if (!idInSite) {
        logError('idInSite not found in item');
        return;
      }

      // Extract the voucher title
      const title = $coupon('div.promoblock--title')
        .text()
        .trim()
        .replace(/\s+/g, ' ');

      if (!title) {
        logError('Coupon title not found in item');
        return;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
        domain,
        sourceUrl: request.url,
      };
      // Since element is a native DOM element, wrap it with Cheerio to use jQuery-like methods
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
      await crawler?.requestQueue?.addRequest(
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
    const codeSpan = $(`span#codetext-${validatorData.idInSite}`);

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
