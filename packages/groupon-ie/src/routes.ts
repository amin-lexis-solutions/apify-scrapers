import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateCouponId,
  getMerchantDomainFromUrl,
  CouponItemResult,
  CouponHashMap,
  checkCouponIds,
  logError,
} from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processCouponItem(merchantName, merchantDomain, voucher, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher?.idInSite;
  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', voucher.description);
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(
    merchantName,
    voucher.idInSite,
    sourceUrl
  );

  const couponUrl = `https://www.groupon.ie/discount-codes/redemption/${idInSite}?merchant=${encodeURI(
    merchantName
  )}&linkType=MerchantPage`;

  return { generatedHash, hasCode: voucher.hasCode, couponUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    const merchantName = $('.merchant-block-background')
      .attr('aria-label')
      ?.split(',')[0];

    if (!merchantName) {
      logError(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantUrl = `https://${$('.merchant-outlink').text()}`;
    const merchantDomain = getMerchantDomainFromUrl(merchantUrl);

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    const vouchers = $('li.coupons-list-row'); // TODO: Extract the vouchers from the page

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            coupons: vouchers,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error) {
      logError(`Preprocess Error: ${error}`);
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];

    for (const voucher of vouchers) {
      const title = $(voucher).find('.coupon-tile-title')?.text();

      if (!title) {
        logError('Coupon title not found in item');
        continue;
      }

      const idInSite = $(voucher)
        ?.find('span[id]')
        ?.attr('id')
        ?.replace('offer-', '');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const hasCode = $(voucher)
        ?.find('.coupon-tile-type')
        ?.text()
        ?.includes('Code');

      const item = { title, idInSite, hasCode };

      const result: CouponItemResult = processCouponItem(
        merchantName,
        merchantDomain,
        item,
        request.url
      );

      if (!result.hasCode) {
        try {
          await postProcess(
            {
              SaveDataHandler: {
                validator: result.validator,
              },
            },
            context
          );
        } catch (error) {
          log.error(`Postprocess Error: ${error}`);
        }
        continue;
      }
      couponsWithCode[result.generatedHash] = result;
      idsToCheck.push(result.generatedHash);
    }

    // Check if the coupons already exist in the database
    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    for (const id of nonExistingIds) {
      const result: CouponItemResult = couponsWithCode[id];
      await enqueueLinks({
        urls: [result.couponUrl],
        userData: {
          ...request.userData,
          label: Label.getCode,
          validatorData: result.validator.getData(),
        },
      });
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
    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    if (!htmlContent.startsWith('{')) {
      log.warning(`Invalid JSON string`);
      return;
    }
    // Safely parse the JSON string
    const jsonCodeData = JSON.parse(htmlContent);

    // Validate the necessary data is present
    if (!jsonCodeData || !jsonCodeData.offerCode) {
      log.warning(`Coupon code not found ${request.url}`);
      return;
    }

    const code = jsonCodeData.offerCode;

    // Add data to validator
    validator.addValue('code', code);
    validator.addValue(
      'termsAndConditions',
      jsonCodeData?.termsAndConditions?.terms
    );
    validator.addValue(
      'expiryDateAt',
      formatDateTime(jsonCodeData?.expiryDateTime)
    );

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
