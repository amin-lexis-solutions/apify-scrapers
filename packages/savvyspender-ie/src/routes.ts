import { createPuppeteerRouter, sleep } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateItemId,
  ItemResult,
  ItemHashMap,
  checkItemsIds,
  logError,
} from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

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
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(merchantName, item.idPool, sourceUrl);

  const hasCode = item?.type === 'code';

  const itemUrl = item.itemUrl;

  return { generatedHash, hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    let allItems: any[] = [];

    const getItems = async () => {
      const items = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.E6jjcn .Zc7IjY')).map(
          (item) => {
            const idInSite = item
              .querySelector('.wixui-repeater__item')
              ?.getAttribute('id')
              ?.split('__')[1];
            const merchantName = item
              .querySelector('div[title]')
              ?.getAttribute('title')
              ?.split(' ')?.[0];
            const title = item.querySelector('.wixui-rich-text__text')
              ?.firstChild?.textContent;
            const description = item.querySelector('p.wixui-rich-text__text')
              ?.textContent;
            const itemUrl = item
              .querySelector('a[data-testid=linkElement]')
              ?.getAttribute('href');

            return { idInSite, title, description, merchantName, itemUrl };
          }
        );
      });
      allItems = [...items, ...allItems];
    };

    const nextPageElement = await page.$("div a[aria-label='Next Page']");

    const nextPageDisabled = async () => {
      const isDisabled = await page.evaluate((node) => {
        return node?.getAttribute('aria-disabled');
      }, nextPageElement);

      if (!isDisabled) await nextPageElement?.click();

      return isDisabled;
    };

    while (nextPageElement) {
      await getItems();
      const isNextPageDisabled = await nextPageDisabled();
      if (isNextPageDisabled) break;
      await sleep(100);
    }

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            items: allItems,
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

    const couponsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];

    for (const item of allItems) {
      if (!item.merchantName) {
        logError(`Merchant name not found ${request.url}`);
        continue;
      }

      if (!item?.title) {
        logError('Coupon title not found in item');
        continue;
      }
      if (!item?.idInSite) {
        logError('idInSite not found in item');
        continue;
      }
      const result: ItemResult = processItem(
        item.merchantName,
        null,
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
      couponsWithCode[result.generatedHash] = result;
      idsToCheck.push(result.generatedHash);
    }

    // Check if the coupons already exist in the database
    const nonExistingIds = await checkItemsIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length == 0) return;

    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      const currentResult: ItemResult = couponsWithCode[id];
      await postProcess(
        {
          SaveDataHandler: {
            validator: currentResult.validator,
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
