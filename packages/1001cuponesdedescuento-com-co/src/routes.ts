import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateItemId,
  getMerchantDomainFromUrl,
  ItemResult,
  ItemHashMap,
  checkItemsIds,
  logError,
} from 'shared/helpers';

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

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, hasCode: item.hasCode, itemUrl: '', validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const currentItems = $('.codelist .codelist-item');
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
      logError(`Preprocess Error: ${error}`);
      return;
    }

    const merchantUrl = null;
    let merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    merchantDomain
      ? log.info(`merchantDomain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];

    for (const item of items) {
      const merchantName = $(item)
        .find('.__logo .__logo-shop')
        .text()
        .split('descuento')[1]
        ?.trim();

      if (!merchantName) {
        logError(`MerchantName not found ${request.url}`);
        continue;
      }

      merchantDomain = merchantName.includes('.') ? merchantName : null;

      const title = $(item).find('.__desc-title h3').text();

      if (!title) {
        logError('Coupon title not found in item');
        continue;
      }

      const idInSite = $(item).find('.__desc.offercontent').attr('data-id');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const description = $(item).find('.__desc-text').text();

      const code = $(item).find('.__desc.offercontent').attr('data-clipb');

      const hasCode = !!code;

      const itemData = {
        title,
        idInSite,
        merchantDomain,
        merchantName,
        description,
        code,
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
