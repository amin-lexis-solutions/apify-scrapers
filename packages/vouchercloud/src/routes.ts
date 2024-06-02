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

function processCouponItem(couponItem: any, $cheerio: any): CouponItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExclusive', $cheerio.IsExclusive);
  validator.addValue('isExpired', !$cheerio.Available);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    couponItem.idInSite,
    couponItem.sourceUrl
  );

  if ($cheerio.OfferType !== 'OnlineCode') {
    return { generatedHash, hasCode: false, couponUrl: '', validator };
  }

  const parsedUrl = new URL(couponItem.sourceUrl);

  const couponUrl = `https://${parsedUrl.hostname}/redeem-out/${couponItem.idInSite}?nonInteraction=False&showInterstitial=False`;

  return { generatedHash, hasCode: true, couponUrl, validator };
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

    // Extracting the 'props' attribute from the 'view-all-codes' element.
    const propsJson = $('view-all-codes').attr('props');

    if (!propsJson) {
      logError('view-all-codes props JSON is missing');
      return;
    }

    const props = JSON.parse(propsJson.replace(/&quot;/g, '"'));

    const merchantName = props.MerchantName;

    if (!merchantName) {
      logError('Unable to find merchant name');
      return;
    }

    const merchantUrl = $('.accordion-mobile-content p a')?.attr('href');

    if (!merchantUrl) {
      log.warning('Unable to find merchantUrl');
    }

    const domain = merchantUrl ? getMerchantDomainFromUrl(merchantUrl) : null;

    const vouchers = props.Offers;

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: vouchers,
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

    for (const element of vouchers) {
      await sleep(1000); // Sleep for 1 second between requests to avoid rate limitings

      const idInSite = element.OfferId.toString();

      if (!idInSite) {
        logError(`not idInSite found in item`);
        continue;
      }

      const title = element.OfferTitle;

      if (!title) {
        logError(`not title found in item`);
        continue;
      }

      const couponItem = {
        idInSite,
        title,
        merchantName,
        domain,
        sourceUrl: request.url,
      };

      result = processCouponItem(couponItem, element);

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
        log.warning(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    let currentResult: CouponItemResult;
    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];

      // Add the coupon URL with a POST method to the request queue, including the required headers
      await crawler.requestQueue.addRequest(
        {
          url: currentResult.couponUrl,
          method: 'POST', // Specify the request method as POST
          headers: {
            ...CUSTOM_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': '0', // Explicitly declare an empty request body
          },
          userData: {
            label: Label.getCode,
            validatorData: currentResult.validator.getData(),
          },
        },
        {
          forefront: true,
        }
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body } = context;

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

    // Safely parse the JSON string
    const jsonCodeData = JSON.parse(htmlContent);

    // Validate the necessary data is present
    if (!jsonCodeData || !jsonCodeData.Code) {
      log.warning('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.Code;
    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
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
