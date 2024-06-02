import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
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
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
};

function processCouponItem(
  couponItem: any,
  $cheerio: cheerio.Root
): CouponItemResult {
  const validator = new DataValidator();

  const buttonElement = $cheerio(
    'button[data-testid="VoucherShowButton"] > p'
  ).first();

  const buttonText = buttonElement?.text()?.trim();

  const hasCode = !!buttonText?.toUpperCase()?.includes('ZUM GUTSCHEIN');

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const couponUrl = hasCode
    ? `https://www.gutscheinsammler.de/api/voucher/${couponItem.idInSite}`
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
    log.warning('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Selecting the script element containing json schema
    const scriptElement = $('script[data-testid="StoreSchemaOrg"]').first();
    const scriptContent = scriptElement?.html();

    if (scriptElement.length == 0 || !scriptContent) {
      logError(`Script content not found ${request.url}`);
      return;
    }

    // Parse the script content as JSON
    const storeData = JSON.parse(scriptContent);

    const merchantName = storeData.name;

    const merchantDomain = getMerchantDomainFromUrl(storeData.sameAs);

    if (!merchantDomain) {
      log.warning(`merchantDomain not found ${request.url}`);
    }

    // Extract valid coupons
    const validCoupons = $(
      'section[data-testid=ActiveVouchers] div[data-testid=VouchersListItem]'
    );

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

    for (const element of validCoupons) {
      const $coupon = cheerio.load(element);

      const idInSite = $coupon('*')?.first()?.attr('data-voucherid');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const title = $coupon('button[class*="VouchersListItem_titleButton"]')
        ?.first()
        ?.text()
        ?.trim();

      if (!title) {
        logError('title not foun in item');
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
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

    if (nonExistingIds.length > 0) {
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
            headers: CUSTOM_HEADERS_LOCAL,
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
  const { request, body, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    let code = '';

    // Attempt to parse the HTML content as JSON
    const parsedJson = JSON.parse(htmlContent);

    // Extract the "o_c" value
    if (
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      'code' in parsedJson
    ) {
      code = parsedJson['code'].trim();
      if (code) {
        log.info(`Found code: ${code}\n    at: ${request.url}`);
        validator.addValue('code', code);
      }
    }

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
