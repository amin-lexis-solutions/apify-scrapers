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
} from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';
import { logger } from 'shared/logger';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

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
  validator.addValue('expiryDateAt', formatDateTime(item.expiryDateAt));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
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
  const { request, page, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const merchantName = await page.evaluate(
      () =>
        document.querySelector('.logo-wrapper img')?.getAttribute('alt') ||
        document.querySelector('.logo-wrapper')?.textContent
    );

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    const currentItems = [...(await page.$$('.item'))];
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
      const title = await page.evaluate(() => {
        return document.querySelector('.merchat-coupon-title')?.textContent;
      }, item);

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }
      const idInSite = await page.evaluate((node) => {
        return node?.getAttribute('id')?.replace('c-', '');
      }, item);

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const code = await page.evaluate(
        (node) => node?.querySelector('.text-code')?.textContent,
        item
      );

      const expiryDateAt = await page.evaluate((node) => {
        const match = node
          .querySelector('.date')
          ?.textContent?.match(/\b(\d{2})-(\d{2})-(\d{2})\b/);

        const day = match?.[1];
        const month = match?.[2];
        const year = match?.[3];

        return `20${year}-${month}-${day}`;
      }, item);

      const hasCode = !!code;

      const itemData = {
        title,
        idInSite,
        merchantDomain: merchantDomain.includes(merchantName)
          ? merchantDomain
          : null,
        code,
        expiryDateAt,
        hasCode,
        merchantName,
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
