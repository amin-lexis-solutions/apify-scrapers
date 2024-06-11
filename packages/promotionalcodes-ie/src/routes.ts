import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateCouponId,
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

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', voucher.description);
  validator.addValue('termsAndConditions', voucher.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', voucher.isExpired);
  validator.addValue('isShown', true);

  if (voucher.code) validator.addValue('code', voucher.code);

  const generatedHash = generateCouponId(
    merchantName,
    voucher.title,
    sourceUrl
  );

  // there not idInSite in page - lets generate it
  validator.addValue('idInSite', generatedHash);

  return { generatedHash, hasCode: !!voucher.code, couponUrl: '', validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const merchantName = $('#merchant-name').text().split('.')[0];

    if (!merchantName) {
      logError(`merchantName not found ${request.url}`);
      return;
    }

    const merchantLogoElement = $('main img').attr('alt');
    const merchantDomain = merchantLogoElement?.includes('.')
      ? merchantLogoElement?.replace(' logo', '')
      : null;

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    const vouchers = $('section ul li')
      .toArray()
      .map((coupon) => {
        const title = $(coupon).find('.font-semibold').text()?.trim();
        const code = $(coupon)
          .find('.clipboard.border-dashed')
          ?.text()
          ?.replace('Code Copied', '')
          ?.trim();
        const isExpired = $(coupon).hasClass('grayscale');
        return { title, code, isExpired };
      });

    const expiredVouchers = [];
    const allVouchers = [...vouchers, ...expiredVouchers];

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            coupons: allVouchers,
          },
        },
        context
      );
    } catch (error) {
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    for (const voucher of allVouchers) {
      if (!voucher.title) {
        logError('title not found in item');
        continue;
      }
      const result: CouponItemResult = processCouponItem(
        merchantName,
        merchantDomain,
        voucher,
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

    if (nonExistingIds.length <= 0) return;

    for (const id of nonExistingIds) {
      const result: CouponItemResult = couponsWithCode[id];
      await postProcess(
        {
          SaveDataHandler: {
            validator: result.validator,
          },
        },
        context
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
