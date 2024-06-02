import cheerio from 'cheerio';
import * as he from 'he';
import { createCheerioRouter, log } from 'crawlee';
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

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  'X-Requested-With': 'XMLHttpRequest',
};

function processCouponItem(
  couponItem: any,
  $cheerio: cheerio.Root
): CouponItemResult {
  const configAttr = $cheerio('*').first().attr('data-voucher-config-value');

  if (!configAttr) {
    log.warning('Attribute data-voucher-config-value is missing');
  }

  const config = JSON.parse(configAttr || '{}');

  // Extract the voucher id

  const hasCode = config.type === 1;
  let couponUrl = '';

  if (hasCode) {
    // Extract domain from the source URL by parsing the URL
    const sourceUrlObj = new URL(couponItem.sourceUrl);
    const sourceDomain = sourceUrlObj.hostname;
    couponUrl = `https://${sourceDomain}/async/voucher-modal?id=${couponItem.idInSite}`;
  }

  // Extract the description
  let description = '';
  const descElement = $cheerio('ul.voucherCard-details').first();
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
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', couponItem.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

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

    log.warning(`Listing ${request.url}`);

    const merchantLogoImgSelector = 'div.shopHeader img.shopLogo';

    // Check if valid page
    if (!$(merchantLogoImgSelector).length) {
      log.warning(`Not Merchant URL: ${request.url}`);
    }
    const merchantLogoImg = $(merchantLogoImgSelector);
    let merchantName = '';

    if (merchantLogoImg.length > 0) {
      merchantName = merchantLogoImg.attr('title')?.trim() || '';
    }

    if (!merchantName) {
      logError('Unable to find merchant name');
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('domain name is missing');
    }

    // Extract valid coupons
    const validCoupons = $(
      'div.voucherGroup div.voucherCard:not(.voucherCard--expired)'
    );
    const expiredCoupons = $(
      'div.voucherGroup div.voucherCard.voucherCard--expired'
    );
    const items = [...validCoupons, ...expiredCoupons];

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

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of items) {
      const $coupon = cheerio.load(item);

      const isExpired = !!$coupon('*').hasClass('voucherCard--expired');
      // Extract the voucher title
      const title = $coupon('span.voucherCard-hubTitleTextMain')
        .first()
        ?.text()
        ?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const configAttr = $coupon('*').first().attr('data-voucher-config-value');

      if (!configAttr) {
        logError('Attribute data-voucher-config-value not found in item');
        continue;
      }

      const config = JSON.parse(configAttr);

      const idInSite = config?.id?.toString();

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        merchantDomain,
        merchantName,
        isExpired,
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
      log.warning(`Unable to find code element in the page: ${request.url}`);
    }
    const code = codeElement.text().trim();

    // Check if the code is found
    if (!code) {
      log.warning(`Coupon code not found in the HTML content: ${request.url}`);
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
