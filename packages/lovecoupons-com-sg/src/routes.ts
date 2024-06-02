import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  getMerchantDomainFromUrl,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  logError,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

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
  couponItem: any,
  $cheerio: cheerio.Root
): CouponItemResult {
  const attrDataType = $cheerio('*').first().attr('data-type');

  if (!attrDataType) {
    log.warning('Attr data-type is missing');
  }

  const hasCode = !!(attrDataType === '2');

  let couponUrl = '';

  const attrDataOut = $cheerio('*')?.first()?.attr('data-out');

  if (hasCode && attrDataOut) {
    couponUrl = new URL(attrDataOut?.trim(), couponItem.sourceUrl).href.replace(
      '/go/2/',
      '/go/3/'
    );
  }

  // Extract the description
  const descrElement = $cheerio('article header > p').first();
  const description = extractAllText(descrElement);

  // Extract terms and conditions
  const tocElement = $cheerio('div.TermsConditions').first();
  const toc = extractAllText(tocElement);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('termsAndConditions', toc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

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
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`rocessing URL: ${request.url}`);

    const merchantLI = $('ul.c-breadcrumbs > li:last-child');

    const merchantName = he.decode(merchantLI ? merchantLI.text().trim() : '');

    if (!merchantName) {
      logError('Merchant name is missing');
      return;
    }

    const domainSpan = $('p.BrandUrl > span');

    const domainUrl = he.decode(domainSpan ? domainSpan.text().trim() : '');

    if (!domainUrl) {
      log.warning('Merchant domain is missing');
    }

    const merchantDomain = getMerchantDomainFromUrl(domainUrl);

    // Extract valid coupons
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    const validCoupons = $('div.BrandOffers > article');

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

    for (const item of validCoupons) {
      const $coupon = cheerio.load(item);

      const idInSite = $coupon('*').first().attr('data-id')?.trim();

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const titleElement = $coupon('.Offer h3.Outlink').first();

      if (!titleElement) {
        logError('Title not found in item');
        continue;
      }

      const title = extractAllText(titleElement);

      const couponItem = {
        title,
        idInSite,
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
    const codeInput = $('div.RevealCoupon > input');

    if (codeInput.length === 0) {
      log.warning('Coupon code input is missing');
    }

    const code = codeInput.val().trim();

    // Check if the code is found
    if (!code) {
      log.info('Coupon code not found in the HTML content');
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
