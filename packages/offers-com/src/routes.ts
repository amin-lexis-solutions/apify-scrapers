import { logger } from 'shared/logger';
import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
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

  const idInSite = item.url.split('em=')[1];
  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', item.name);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.validThrough));
  validator.addValue('startDateAt', formatDateTime(item.validFrom));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(merchantName, item.idPool, sourceUrl);

  return { generatedHash, hasCode: true, itemUrl: item.url, validator };
}
// TODO: To inspect later Missing merchantName & code
router.addHandler(Label.listing, async (context) => {
  const { request, $, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const itemScript = $("script[type='application/ld+json']")?.html();

    const itemInPage = $('#coupons');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            items: itemInPage,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error) {
      logger.error(`Preprocess Error: ${request.url}`, error);
      return;
    }

    if (!itemScript) {
      logger.error(`itemScript not found in page - ${request.url}`);
      return;
    }

    const itemsJSON = JSON.parse(itemScript);

    const merchantName = itemsJSON?.name;

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantUrl = itemsJSON?.sameAs;
    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    const currentItems = itemsJSON.makesOffer;
    const items = [...currentItems];

    for (const item of items) {
      if (!item?.name) {
        logger.error('Coupon title not found in item');
        continue;
      }
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
        logger.error(`Postprocess Error: ${error}`);
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

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
    let code = $('div[x-data^="couponCode"]')?.attr('x-data');

    const match = code?.match(/'([^']+)'/g);

    if (!match) {
      log.warning('No code found');
    }

    code = match?.[1]?.replace(/'/g, '');

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
      logger.error(`Postprocess Error: ${error}`);
      return;
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
