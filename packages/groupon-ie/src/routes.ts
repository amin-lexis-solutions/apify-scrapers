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
    const items = $('li.coupons-list-row');

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

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];

    for (const selector of items) {
      const title = $(selector).find('.coupon-tile-title')?.text();

      if (!title) {
        logError('Coupon title not found in item');
        continue;
      }

      const idInSite = $(selector)
        ?.find('span[id]')
        ?.attr('id')
        ?.replace('offer-', '');

      if (!idInSite) {
        logError('idInSite not found in item');
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
