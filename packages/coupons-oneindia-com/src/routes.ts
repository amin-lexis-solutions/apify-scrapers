import { createPuppeteerRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  CouponHashMap,
  CouponItemResult,
  checkCouponIds,
  checkExistingCouponsAnomaly,
  formatDateTime,
  generateCouponId,
  getDomainName,
  processAndStoreData,
} from 'shared/helpers';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processCouponItem(
  merchantName,
  domain,
  retailerId,
  voucher,
  sourceUrl
) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher?.idPool?.replace('in_', '');
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

  const generatedHash = generateCouponId(
    merchantName,
    voucher.idPool,
    sourceUrl
  );

  const hasCode = voucher?.type.includes('code');

  const couponUrl = `https://coupons.oneindia.com/api/voucher/country/in/client/${retailerId}/id/${voucher?.idPool}`;

  return { generatedHash, hasCode, couponUrl, validator };
}

router.addHandler(
  Label.listing,
  async ({ request, page, enqueueLinks, log }) => {
    if (request.userData.label !== Label.listing) return;

    try {
      const jsonContent = await page.$eval(
        'script[id="__NEXT_DATA__"]',
        (script) => script?.textContent
      );

      let jsonData = JSON.parse(jsonContent || '{}');
      let retailerId;

      if (jsonData && jsonData.props) {
        retailerId = jsonData.query.clientId;
        jsonData = jsonData.props.pageProps;
      } else {
        throw new Error('Missing jsonContent');
      }
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
        log.error(`Coupons anomaly detected - ${request.url}`);
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
        console.log(result.hasCode, result.couponUrl);
        if (result.hasCode) {
          couponsWithCode[result.generatedHash] = result;
          idsToCheck.push(result.generatedHash);
        } else {
          await processAndStoreData(result.validator);
        }
        // Call the API to check if the coupon exists
        const nonExistingIds = await checkCouponIds(idsToCheck);

        if (nonExistingIds.length == 0) return;

        let currentResult: CouponItemResult;

        for (const id of nonExistingIds) {
          currentResult = couponsWithCode[id];
          // Add the coupon URL to the request queue
          await enqueueLinks({
            urls: [currentResult.couponUrl],
            userData: {
              label: Label.getCode,
              validatorData: currentResult.validator.getData(),
            },
          });
        }
      }
    } finally {
      // We don't catch so that the error is logged in Sentry, but use finally
      // since we want the Apify actor to end successfully and not waste resources by retrying.
    }
  }
);
router.addHandler(Label.getCode, async (context) => {
  // Destructure objects from the context
  const { request, page, log } = context;

  try {
    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);
    // Get the HTML content of the page
    const htmlContent = await page.content();
    // Match the pattern "code":"..." in the HTML content
    const match = htmlContent.match(/"code":"([^"]+)"/);
    // If no match is found, exit
    if (match?.length == 0) return;
    // Add the matched code value to the validator
    validator.addValue('code', match?.[1]);
    // Process and store data using the validator
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
