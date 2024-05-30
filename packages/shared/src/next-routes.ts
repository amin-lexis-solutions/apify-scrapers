import { createCheerioRouter } from 'crawlee';
import { DataValidator } from './data-validator';
import {
  sleep,
  getMerchantDomainFromUrl,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  formatDateTime,
} from './helpers';
import { preProcess, postProcess } from './hooks';
import { Label, CUSTOM_HEADERS } from './actor-utils';

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
  item: any,
  sourceUrl: string,
  nextData: any
): CouponItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = (
    item?.idPool?.split('_')?.[1] ||
    item?.idVoucher ||
    item?.idInSite
  )?.toString();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', domain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  // code must be checked to decide the next step
  const codeType = checkVoucherCode(item.code);

  if (codeType.isEmpty) {
    return { generatedHash, hasCode: false, couponUrl: '', validator };
  }

  if (!codeType.startsWithDots) {
    validator.addValue('code', codeType.code);
    return { generatedHash, hasCode: false, couponUrl: '', validator };
  }

  const retailerId = nextData.query.clientId;
  const retailerCountry = nextData.props.pageProps.retailer.country;
  const idPool = item.idPool;
  const assetsBaseUrl = nextData.props.pageProps.assetsBaseUrl;

  const couponUrl = `${assetsBaseUrl}/api/voucher/country/${retailerCountry}/client/${retailerId}/id/${idPool}`;

  return { generatedHash, hasCode: true, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, crawler, log } = context;

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

    if (!match || !match?.[1]) {
      return;
    }

    const nextData = JSON.parse(match?.[1]);

    const pageProps = nextData.props.pageProps;

    if (!pageProps || !pageProps.retailer) {
      throw new Error('Retailer data is missing in the parsed JSON');
    }

    console.log(
      `\n\nFound ${pageProps.vouchers.length} active vouchers and ${pageProps.expiredVouchers.length} expired vouchers\n    at: ${request.url}\n`
    );

    // Declarations outside the loop
    const merchantName = pageProps.retailer.name;
    const merchantUrl = pageProps.retailer.merchant_url;
    const domain = getMerchantDomainFromUrl(merchantUrl);

    if (!domain) {
      log.info('Domain is missing!');
    }

    // Combine active and expired vouchers
    const activeVouchers = pageProps.vouchers.map((voucher) => ({
      ...voucher,
      is_expired: false,
    }));
    const expiredVouchers = pageProps.expiredVouchers.map((voucher) => ({
      ...voucher,
      is_expired: true,
    }));
    const vouchers = [...activeVouchers, ...expiredVouchers];

    // pre-pressing hooks  here to avoid unnecessary requests
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
      log.info(`Pre-Processing Error : ${error.message}`);
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of vouchers) {
      await sleep(1000); // Sleep for 1 second between requests to avoid rate limitings

      result = processCouponItem(
        merchantName,
        domain,
        item,
        request.url,
        nextData
      );

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
        log.info(`Post-Processing Error : ${error.message}`);
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
            ...request.userData,
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
    if (!jsonCodeData || !jsonCodeData.code) {
      throw new Error('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.code;
    console.log(`Found code: ${code}\n    at: ${request.url}`);

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
