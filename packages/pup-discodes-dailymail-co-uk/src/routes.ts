import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  getMerchantDomainFromUrl,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  formatDateTime,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

declare global {
  interface Window {
    __NEXT_DATA__?: any; // You can replace `any` with a more specific type if you have one
  }
}

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
  domain: string,
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
      couponUrl = `https://discountcode.dailymail.co.uk/api/voucher/country/uk/client/${retailerId}/id/${idPool}`;
    }
  }

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.listing, async ({ page, request, enqueueLinks }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`\nProcessing URL: ${request.url}`);

    await page.waitForFunction(() => {
      return !!window.__NEXT_DATA__;
    });

    const htmlContent = await page.content();
    const jsonPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
    const match = htmlContent.match(jsonPattern);

    let jsonData;
    let retailerId;
    if (match && match[1]) {
      jsonData = JSON.parse(match[1]);
      retailerId = jsonData.query.clientId;
      jsonData = jsonData.props.pageProps;
    } else {
      throw new Error(
        'No matching script tag found or no JSON content present'
      );
    }

    if (!jsonData.retailer) {
      throw new Error('Retailer data is missing in the parsed JSON');
    }

    console.log(
      `\n\nFound ${jsonData.vouchers.length} active vouchers and ${jsonData.expiredVouchers.length} expired vouchers\n    at: ${request.url}\n`
    );

    const merchantName = jsonData.retailer.name;
    const merchantUrl = jsonData.retailer.merchant_url;
    const domain = getMerchantDomainFromUrl(merchantUrl);

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
      let validatorData;
      for (const id of nonExistingIds) {
        currentResult = couponsWithCode[id];
        validatorData = currentResult.validator.getData();

        await enqueueLinks({
          urls: [currentResult.couponUrl],
          userData: {
            label: Label.getCode,
            validatorData,
          },
          forefront: true,
        });
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async ({ page, request }) => {
  if (request.userData.label !== Label.getCode) return;

  try {
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const htmlContent = await page.content();
    const jsonPattern = /<pre[^>]*>(.*?)<\/pre>/s;
    const match = htmlContent.match(jsonPattern);

    if (match && match[1]) {
      const jsonCodeData = JSON.parse(match[1]);
      const code = jsonCodeData.code;
      console.log(`Found code: ${code}\n    at: ${request.url}`);
      validator.addValue('code', code);
      await processAndStoreData(validator);
    } else {
      throw new Error('No matching pre tag found or no JSON content present');
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
