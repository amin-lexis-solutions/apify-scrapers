import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateItemId,
  ItemResult,
  ItemHashMap,
  checkItemsIds,
} from 'shared/helpers';
import { logger } from 'shared/logger';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(item: any) {
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
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  const itemUrl = `${item.sourceUrl}?promoid=${item.idInSite}`;

  return { generatedHash, hasCode: item.hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const merchantName = $('.cpbotlogo img').attr('alt')?.split(' ')?.[0];

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantDomain = request.url.split('/')?.pop()?.replace('-', '.');

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    const currentItems = $('.item-wrapper');
    const expiredItems = [];
    const items = [...currentItems, ...expiredItems];

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

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];

    for (const item of items) {
      const title = $(item).find('.coupon-title')?.text()?.trim();

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }

      const idInSite = $(item).attr('data-id');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const hasCode = $(item).find('.get-code')?.hasClass('get-code');

      const itemData = {
        idInSite,
        title,
        merchantDomain,
        merchantName,
        hasCode,
        sourceUrl: request.url,
      };

      const result: ItemResult = processItem(itemData);

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
      itemsWithCode[result.generatedHash] = result;
      idsToCheck.push(result.generatedHash);
    }

    // Check if the coupons already exist in the database
    const nonExistingIds = await checkItemsIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    for (const id of nonExistingIds) {
      const result: ItemResult = itemsWithCode[id];

      if (!result.itemUrl) continue;

      await enqueueLinks({
        urls: [result.itemUrl],
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
    const code = $('.code-box .code-text').text();

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
