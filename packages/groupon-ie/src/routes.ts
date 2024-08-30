import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  formatDateTime,
  generateItemId,
  getMerchantDomainFromUrl,
  ItemResult,
} from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(merchantName, merchantDomain, item, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = item?.idInSite;
  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(merchantName, item.idInSite, sourceUrl);

  const itemUrl = `https://www.groupon.ie/discount-codes/redemption/${idInSite}?merchant=${encodeURI(
    merchantName
  )}&linkType=MerchantPage`;

  return { generatedHash, hasCode: item.hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    const items = $('.coupons-list .coupon-offer-tile');

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
    } catch (error) {
      logger.error(`Preprocess Error: ${error}`);
      return;
    }

    const merchantName = $('.merchant-block-background')
      .attr('aria-label')
      ?.split(',')[0];

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantOutlink = $('.merchant-outlink').text() || null;
    const merchantUrl = merchantOutlink ? `https://${merchantOutlink}` : null;
    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    for (const selector of items) {
      // extract title, idInSite, and hasCode from the item cheerio object
      const title = $(selector)?.find('.coupon-tile-title')?.text()?.trim();

      if (!title) {
        logger.error(`Title not found in item ${request.url}`);
        continue;
      }

      const idInSite = $(selector)
        ?.find('span[id]')
        ?.attr('id')
        ?.replace('offer-', '');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const hasCode = $(selector)
        ?.find('.coupon-tile-type')
        ?.text()
        ?.includes('Code');

      const item = { title, idInSite, hasCode };

      const result: ItemResult = processItem(
        merchantName,
        merchantDomain,
        item,
        request.url
      );

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        await enqueueLinks({
          urls: [result.itemUrl],
          userData: {
            ...request.userData,
            label: Label.getCode,
            validatorData: result.validator.getData(),
          },
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
