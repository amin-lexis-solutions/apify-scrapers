import { createPuppeteerRouter } from 'crawlee';
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
export const router = createPuppeteerRouter();

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

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  const hasCode = item.hasCode;

  const itemUrl = `${item.sourceUrl}#d-${item.idInSite}`;

  return { generatedHash, hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const currentItems = await page.$$('.coupons__item');
    const expiredItems = []; // There is not item expired on page
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

    const merchantName = await page.evaluate(() => {
      return document
        .querySelector('.fallback_link')
        ?.getAttribute('data-tracking-label');
    });

    if (!merchantName) {
      logError(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantUrl = request.url;
    const merchantDomain = getMerchantDomainFromUrl(merchantUrl);

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];

    for (const itemHandle of items) {
      const title = await page.evaluate((node) => {
        return node?.querySelector('.coupon__title')?.textContent;
      }, itemHandle);

      if (!title) {
        logError('Coupon title not found in item');
        continue;
      }

      const idInSite = await page.evaluate((node) => {
        return node
          ?.querySelector('.coupon__title')
          ?.getAttribute('data-coupon-id');
      }, itemHandle);

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const description = await page.evaluate((node) => {
        return node?.querySelector('.coupon__description')?.textContent;
      }, itemHandle);

      const hasCode = await page.evaluate((node) => {
        return !!node?.querySelector('.coupon__label-code');
      }, itemHandle);

      const itemData = {
        merchantDomain,
        merchantName,
        title,
        description,
        hasCode,
        idInSite,
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
  const { request, page, log } = context;

  try {
    await page.setJavaScriptEnabled(true);

    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);

    const modalElement = await page.$('.modal__dialog');

    const code = await page.evaluate((node) => {
      return node?.querySelector('.coupon-code')?.textContent?.trim();
    }, modalElement);

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
