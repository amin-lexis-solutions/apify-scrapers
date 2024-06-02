import cheerio from 'cheerio';
import * as he from 'he';
import * as buffer from 'buffer';
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

function processCouponItem(
  couponItem: any,
  $coupon: cheerio.Root
): CouponItemResult {
  const dataType = $coupon('*').first().attr('data-type')?.trim();

  if (!dataType) {
    log.warning('Element data-type attr is missing');
  }

  const isExpired = $coupon('*').parent().attr('class')?.includes('expired');

  const hasCode = dataType === 'code';

  const couponUrl = hasCode
    ? `${couponItem.sourceUrl}?promoid=${couponItem.idInSite}`
    : '';

  // Extract the description
  const descElement = $coupon('*[itemprop="description"]');
  let description = '';
  if (descElement.length > 0) {
    description = descElement.text().trim();
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
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
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantLink = $('div.page_link_n > div > span');

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      logError('Merchant name is missing');
      return;
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('Domain is missing');
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult | undefined;

    // Extract valid coupons
    const validCoupons = $('div.c_list:not(.expired) > div[itemprop="offers"]');
    const expiredCoupons = $('div.c_list.expired > div[itemprop="offers"]');

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

    for (const item of items) {
      const $coupon = cheerio.load(item);

      const idAttr = $coupon('*').first().attr('id')?.trim();

      if (!idAttr) {
        logError('idInSite not found in item');
        continue;
      }

      const idInSite = idAttr.split('_').pop();

      // Extract the voucher title
      const title = $coupon('div.coupon_word > a.coupon_title')
        ?.first()
        ?.text()
        ?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const couponItem = {
        title,
        merchantName,
        merchantDomain,
        idInSite,
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
        log.warning(`Coupon code part ${key} class attr is missing`);
        return;
      }
      classValues.push(classValue);
    }

    // Extract the coupon code encrypted parts
    const parts: string[] = [];
    let i = 0;
    for (const classValue of classValues) {
      const part = classValue.match(regex);
      if (!part || !part[1]) {
        log.warning(`Coupon code part ${keys[i]} is missing`);
        return;
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
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator: validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
