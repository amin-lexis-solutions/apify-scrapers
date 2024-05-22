import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  getDomainName,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  formatDateTime,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

function checkVoucherCode(code: string | null | undefined) {
  // Trim the code to remove any leading/trailing whitespace
  const trimmedCode = code?.trim();

  // Check if the code is null or an empty string after trimming
  if (!trimmedCode) {
    return {
      isEmpty: true,
      code: '',
      startsWithDots: false,
    };
  }

  // Check if the trimmed code starts with '...'
  if (trimmedCode.startsWith('...')) {
    return {
      isEmpty: false,
      code: trimmedCode,
      startsWithDots: true,
    };
  }

  // Check if the trimmed code is shorter than 5 characters
  if (trimmedCode.length < 5) {
    return {
      isEmpty: false,
      code: trimmedCode,
      startsWithDots: true, // This is not a typo, it's intentional
    };
  }

  // If the code is not empty and does not start with '...', it's a regular code
  return {
    isEmpty: false,
    code: trimmedCode,
    startsWithDots: false,
  };
}

function processCouponItem(
  merchantName: string,
  domain: string | null,
  retailerId: string,
  voucher: any,
  sourceUrl: string
): CouponItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher.idVoucher.toString();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', domain);
  validator.addValue('description', voucher.description);
  validator.addValue('termsAndConditions', voucher.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', voucher.isExpired);
  validator.addValue('isShown', true);

  // code must be checked to decide the next step
  const codeType = checkVoucherCode(voucher.code);

  // Add the code to the validator
  let hasCode = false;
  let couponUrl = '';
  if (!codeType.isEmpty) {
    if (!codeType.startsWithDots) {
      validator.addValue('code', codeType.code);
    } else {
      hasCode = true;
      const idPool = voucher.idPool;
      couponUrl = `https://alennuskoodit.suomi24.fi/api/voucher/country/fi/client/${retailerId}/id/${idPool}`;
    }
  }

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Define a regex pattern to extract the JSON from the script tag
    const jsonPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;

    // Use the regex pattern to extract the JSON string
    const match = htmlContent.match(jsonPattern);

    let jsonData;
    let retailerId;
    if (match && match[1]) {
      try {
        // Parse the JSON string
        jsonData = JSON.parse(match[1]);
      } finally {
        // We don't catch so that the error is logged in Sentry, but use finally
        // since we want the Apify actor to end successfully and not waste resources by retrying.
      }
      retailerId = jsonData.query.clientId;
      jsonData = jsonData.props.pageProps;
    } else {
      throw new Error(
        'No matching script tag found or no JSON content present'
      );
    }

    if (!jsonData || !jsonData.retailer) {
      throw new Error('Retailer data is missing in the parsed JSON');
    }

    console.log(
      `\n\nFound ${jsonData.vouchers.length} active vouchers and ${jsonData.expiredVouchers.length} expired vouchers\n    at: ${request.url}\n`
    );

    // Declarations outside the loop
    const merchantName = jsonData.retailer.name;
    const merchantUrl = jsonData.retailer.merchant_url;
    const domain = getDomainName(merchantUrl);

    // Combine active and expired vouchers
    const activeVouchers = jsonData.vouchers.map((voucher) => ({
      ...voucher,
      is_expired: false,
    }));
    const expiredVouchers = jsonData.expiredVouchers.map((voucher) => ({
      ...voucher,
      is_expired: true,
    }));
    const vouchers = [...activeVouchers, ...expiredVouchers];

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      vouchers.length
    );

    if (hasAnomaly) {
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    for (const voucher of vouchers) {
      await sleep(1000); // Sleep for 1 second between requests to avoid rate limitings
      result = processCouponItem(
        merchantName,
        domain,
        retailerId,
        voucher,
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
    let jsonCodeData;
    try {
      jsonCodeData = JSON.parse(htmlContent);
    } finally {
      // We don't catch so that the error is logged in Sentry, but use finally
      // since we want the Apify actor to end successfully and not waste resources by retrying.
    }

    // Validate the necessary data is present
    if (!jsonCodeData || !jsonCodeData.code) {
      throw new Error('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.code;
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
