import { logger } from 'shared/logger';
import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { formatDateTime, ItemResult } from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(item) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);

  // Add optional values to the validator
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);
  validator.addValue('code', item.code);

  const hasCode = !!item.code;

  return { hasCode, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const items = $('.row.coupon-row');

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

    const merchantName = $('#butiksnamn').text();

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantUrl = $('.store-details2 .external').text();
    const merchantDomain = merchantUrl.length > 0 ? merchantUrl : null;

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning(`'merchantDomain not found on ${request.url}`);

    for (const item of items) {
      const title = $(item).find('small h4 a')?.text();

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }

      const idInSite = $(item)
        .find('.very-small6 h4 a')
        ?.attr('href')
        ?.split('/')
        ?.pop();

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const description = $(item).find('.coupon-description-box').text();

      const code = $(item).find('.code-hidden').text();

      const itemData = {
        title,
        idInSite,
        merchantDomain,
        merchantName,
        description,
        code,
        sourceUrl: request.url,
      };

      const result: ItemResult = processItem(itemData);

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
