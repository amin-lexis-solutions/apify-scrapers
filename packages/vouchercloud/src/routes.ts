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
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

function processCouponItem(
  merchantName: string,
  voucher: any,
  domain: string,
  sourceUrl: string
): CouponItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher.OfferId.toString();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucher.OfferTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExclusive', voucher.IsExclusive);
  validator.addValue('isExpired', voucher.Available);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  if (voucher.OfferType !== 'OnlineCode') {
    return { generatedHash, hasCode: false, couponUrl: '', validator };
  }

  const parsedUrl = new URL(sourceUrl);

  const couponUrl = `https://${parsedUrl.hostname}${voucher.RedeemUrl}`;
  return { generatedHash, hasCode: true, couponUrl, validator };
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

    // Extracting the 'props' attribute from the 'view-all-codes' element.
    const propsJson = $('view-all-codes').attr('props');

    if (!propsJson) {
      throw new Error('view-all-codes props JSON is missing');
    }

    const props = JSON.parse(propsJson.replace(/&quot;/g, '"'));

    const merchantName = props.MerchantName;

    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }

    const domain = getDomainName(request.url);

    const vouchers = props.Offers;

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const voucher of vouchers) {
      await sleep(1000); // Sleep for 1 second between requests to avoid rate limitings
      result = processCouponItem(merchantName, voucher, domain, request.url);
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
      throw new Error('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.Code;
    console.log(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
