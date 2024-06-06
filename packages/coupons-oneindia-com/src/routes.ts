import { createPuppeteerRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  CouponHashMap,
  CouponItemResult,
  checkCouponIds,
  formatDateTime,
  generateCouponId,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { postProcess, preProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processCouponItem(couponItem): CouponItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = couponItem?.idPool?.replace('in_', '');

  // Add required values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', couponItem?.merchantDomain);
  validator.addValue('description', couponItem?.description);
  validator.addValue('termsAndConditions', couponItem?.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(couponItem?.endTime));
  validator.addValue('startDateAt', formatDateTime(couponItem?.startTime));
  validator.addValue('isExclusive', couponItem?.exclusiveVoucher);
  validator.addValue('isExpired', couponItem?.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(
    couponItem.merchantName,
    idInSite,
    couponItem.sourceUrl
  );

  const hasCode = couponItem?.type.includes('code');

  const couponUrl = `https://coupons.oneindia.com/api/voucher/country/in/client/${couponItem?.retailerId}/id/${couponItem?.idPool}`;

  return { generatedHash, hasCode, couponUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const nextDataElement = await page.$eval(
      'script[id="__NEXT_DATA__"]',
      (script) => script?.textContent
    );

    if (!nextDataElement) {
      logError(`nextData element no found in url`);
      return;
    }

    const nextData = JSON.parse(nextDataElement);

    if (!nextData || !nextData?.props) {
      logError(`nextData props no found in ${request.url}`);
      return;
    }

    const retailerId = nextData?.query?.clientId;
    const pageProps = nextData?.props?.pageProps;

    // Declarations outside the loop
    const merchantName = pageProps?.retailer?.name;

    if (!merchantName) {
      logError(`merchantName not found JSON nextData - ${request.url}`);
      return;
    }

    const merchantUrl = pageProps?.retailer?.merchant_url;

    if (!merchantUrl) {
      log.warning(`merchantDomainUrl not found ${request.url}`);
    }

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;
    // Combine active and expired vouchers
    const activeItems = pageProps.vouchers.map((voucher) => ({
      ...voucher,
      is_expired: false,
    }));

    const expiredItems = pageProps.expiredVouchers.map((voucher) => ({
      ...voucher,
      is_expired: true,
    }));

    const items = [...activeItems, ...expiredItems];

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

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of items) {
      if (!item.idPool) {
        logError(`idInSite no found in item`);
        continue;
      }

      if (!item.title) {
        logError(`title no found in item`);
        continue;
      }

      const couponItem = {
        merchantName,
        merchantDomain,
        retailerId,
        sourceUrl: request.url,
        ...item,
      };

      result = processCouponItem(couponItem);

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
      await enqueueLinks({
        urls: [currentResult.couponUrl],
        userData: {
          label: Label.getCode,
          validatorData: currentResult.validator.getData(),
        },
      });
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
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
