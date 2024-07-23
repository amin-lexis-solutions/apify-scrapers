import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  generateItemId,
  ItemHashMap,
  checkItemsIds,
  ItemResult,
  logError,
  formatDateTime,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

function processItem(item: any) {
  const validator = new DataValidator();

  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('isShown', true);
  validator.addValue('isExpired', false);
  validator.addValue('expiryDateAt', formatDateTime(item.expiryDateAt));
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('termsAndConditions', item.termsAndConditions);

  const itemUrl = `https://www.poulpeo.com/o.htm?c=${item.idInSite}`;

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, hasCode: item.hasCode, itemUrl, validator };
}
router.addHandler(Label.listing, async (context) => {
  const { page, request, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  async function getMerchantName(page) {
    return await page.evaluate(() => {
      return document.querySelector('.m-pageHeader__title')?.textContent;
    });
  }

  async function makeRequest(itemUrl, validatorData) {
    await enqueueLinks({
      urls: [itemUrl],
      userData: {
        label: Label.getCode,
        validatorData,
      },
      forefront: true,
    });
  }

  try {
    log.info(`Listing ${request.url}`);

    const items = await page.$$('.-horizontal.m-offer');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            items,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    const merchantName = await getMerchantName(page);

    if (!merchantName) {
      logError('merchan name not found');
      return;
    }

    // Extract items
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const element of items) {
      const codeElement = await element.$(
        '.m-offer__action .a-btnSlide__truncateCode'
      );

      const title = await page.evaluate(
        (node) => node.querySelector('.m-offer__title')?.textContent,
        element
      );

      if (!title) {
        logError(`not couponTitle found in item`);
        continue;
      }

      const idInSite = await page.evaluate((block) => {
        return (
          block?.getAttribute('data-offer-id') ||
          block?.getAttribute('id')?.replace('r', '')
        );
      }, element);

      if (!idInSite) {
        logError(`not idInSite found in item`);
        continue;
      }

      const expiryDateAt = await page.evaluate((node) => {
        const details = node?.querySelector('.m-offer__details')?.innerHTML;
        const match = details?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return match?.[0];
      }, element);

      const termsAndConditions = await page.evaluate((node) => {
        return node?.querySelector('.m-offer__details')?.textContent;
      }, element);

      const itemData = {
        merchantName,
        title,
        termsAndConditions,
        idInSite,
        expiryDateAt,
        hasCode: !!codeElement,
        sourceUrl: request.url,
      };

      result = processItem(itemData);

      if (result.hasCode) {
        itemsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
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
      } catch (error: any) {
        logError(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkItemsIds(idsToCheck);

    if (nonExistingIds?.length === 0) return;

    let currentResult: ItemResult;

    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
      // Add the coupon URL to the request queue
      await makeRequest(currentResult.itemUrl, currentResult.validator);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  const { page, request, log } = context;

  if (request.userData.label !== Label.getCode) return;

  log.info(`GetCode ${request.url}`);

  await page.waitForNavigation();

  try {
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const code = await page.evaluate(() =>
      document.querySelector('.coupon-panel #ic')?.getAttribute('value')
    );

    if (code) {
      validator.addValue('code', code);
    }

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

export { router };
