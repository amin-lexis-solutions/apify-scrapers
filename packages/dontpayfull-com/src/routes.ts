import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { formatDateTime } from 'shared/helpers';
import { logger } from 'shared/logger';
import { preProcess, postProcess } from 'shared/hooks';
import jp from 'jsonpath';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(merchantName, merchantDomain, voucher, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', voucher.idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', voucher.description);
  validator.addValue('termsAndConditions', voucher.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', voucher.isExpired);
  validator.addValue('isShown', true);

  const hasCode = voucher?.type === 'code';

  const itemUrl = `https://www.dontpayfull.com/coupons/getcoupon?id=${voucher.idInSite}`;

  return { hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { $, log, enqueueLinks, request } = context;
  if (request.userData.label !== Label.listing) return;

  const cloudflareChallenge = $('#challenge-error-title').length > 0;
  if (cloudflareChallenge) {
    throw new Error('Cloudflare challenge detected, retrying...');
  }

  try {
    if (!request.url) {
      logger.error('Request URL not found');
      return;
    }

    const merchantName = $('.store-title strong').text() || null;

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const scriptContent =
      $('script[type="application/ld+json"]').first().html() || '{}';

    const jsonData = JSON.parse(scriptContent) || {};

    const merchantUrl =
      jp.query(jsonData, "$..[?(@.type == 'Store')].url")[0] ||
      jp.query(jsonData, "$..[?(@.type == 'Store')].sameAs")[0] ||
      null;

    const merchantDomain = merchantUrl ? new URL(merchantUrl).hostname : null;

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    const currentItems = $(
      '#active-coupons li.obox:not(.not-offer):not(.oextension):not(.sponsored)[data-id]'
    );

    const expiredItems = $('#expired-coupons li.oexpired');

    const items = [
      ...currentItems
        .map((_, el) => {
          const $el = $(el);
          return {
            title: $el.find('.otitle').text().trim(),
            idInSite: $el.attr('data-id'),
            description: $el.find('.osubtitle').text().trim() || null,
            termsAndConditions:
              $el.find('.details-terms-box').text().trim() || null,
            startTime: null,
            endTime: $el.find('.oexpire time').attr('datetime') || null,
            exclusiveVoucher: $el.find('.oexclusive').length > 0,
            isExpired: false,
            isVerified: $el.find('.overified').length > 0,
            type: $el.attr('data-coupon') === 'yes' ? 'code' : 'deal',
          };
        })
        .get(),
      ...expiredItems
        .map((_, el) => {
          const $el = $(el);
          return {
            title: $el.find('.otitle').text().trim() || null,
            idInSite: $el.attr('data-id') || null,
            description: $el.find('.osubtitle').text().trim() || null,
            termsAndConditions:
              $el.find('.details-terms-box').text().trim() || null,
            startTime: null,
            endTime: $el.find('.oexpire time').attr('datetime') || null,
            exclusiveVoucher: $el.find('.oexclusive').length > 0,
            isExpired: true,
            isVerified: $el.find('.overified').length > 0,
            type: $el.attr('data-coupon') === 'yes' ? 'code' : 'deal',
          };
        })
        .get(),
    ];

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            items,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error: any) {
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    for (const item of items) {
      if (!item.title || !item.idInSite) {
        logger.info('Title not found');
        continue;
      }

      const result = processItem(
        merchantName,
        merchantDomain,
        item,
        request.url
      );

      if (result.hasCode) {
        await enqueueLinks({
          urls: [result.itemUrl],
          userData: {
            ...request.userData,
            label: Label.getCode,
            validatorData: result.validator.getData(),
          },
          forefront: true,
        });
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
      } catch (error) {
        log.error(`Postprocess Error: ${error}`);
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

// TODO: Implement the handler for the getCode label if needed
router.addHandler(Label.getCode, async (context) => {
  // Destructure objects from the context
  const { request, $, log } = context;

  try {
    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);

    // Get the code value from the JSON response
    const code = $('#copy-me').text() || null;

    if (!code) {
      log.warning('No code found');
    }

    // Add the code value to the validator
    validator.addValue('code', code);

    try {
      await postProcess(
        {
          SaveDataHandler: { validator },
        },
        context
      );
    } catch (error) {
      log.error(`Postprocess Error: ${error}`);
      return;
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
