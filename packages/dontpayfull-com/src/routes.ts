import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  generateItemId,
  ItemHashMap,
  checkItemsIds,
  ItemResult,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { createPuppeteerRouter } from 'crawlee';
import { postProcess, preProcess } from 'shared/hooks';
import { ElementHandle } from 'puppeteer';

export const router = createPuppeteerRouter();

// Handler function for processing coupon listings
router.addHandler(Label.listing, async (context) => {
  const { request, page, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  async function processCoupon(
    item: any,
    element: ElementHandle<HTMLLIElement>
  ) {
    const hasCode = !!(await element.evaluate((node) => {
      const attr = node?.getAttribute('data-coupon');
      return attr;
    }));
    // Create a data validator instance
    const validator = new DataValidator();
    // Add required and optional values to the validator
    validator.addValue('merchantName', item.merchantName);
    validator.addValue('domain', item.merchantDomain);
    validator.addValue('title', item.title);
    validator.addValue('sourceUrl', item.sourceUrl);
    validator.addValue('idInSite', item.idInSite);

    validator.addValue('isShown', true);
    validator.addValue('isExpired', false);
    // Generate a hash for the coupon
    const generatedHash = generateItemId(
      item.merchantName,
      item.idInSite,
      item.sourceUrl
    );

    const itemUrl = `https://www.dontpayfull.com/at/${item.merchantDomain}?c=${item.idInSite}#c${item.idInSite}`;

    return { generatedHash, hasCode, itemUrl, validator };
  }
  async function makeRequest(url, validator) {
    await enqueueLinks({
      urls: [url],
      userData: {
        label: Label.getCode,
        validatorData: validator.getData(),
      },
      forefront: true,
    });
  }
  try {
    log.info(`Listing ${request.url}`);

    const currentItems = await page.$$('#active-coupons li.obox.code');
    const expiredItems = await page.$$('#expired-coupons li.oexpired');

    const items = [...currentItems, ...expiredItems];

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

    // Extract the merchant name
    const merchantName = await page.$eval('.sidebar-menu-box a', (a) =>
      a?.getAttribute('data-store')
    );
    // Throw an error if merchant name is not found
    if (!merchantName) {
      logError(`merchantName not found sourceUrl ${request.url}`);
      return;
    }
    // Extract coupon list elements from the webpage
    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('merchantDomain not found');
    }

    // Initialize variables
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: any;
    // Loop through each coupon element and process it

    for (const element of items) {
      const title = await element.$eval('h3', (title) =>
        title?.textContent?.trim()
      );

      if (!title) {
        logError(`coupon title not found`);
        continue;
      }

      const idInSite = await element.evaluate((node) =>
        node?.getAttribute('data-id')
      );
      // // Throw an error if ID is not found
      if (!idInSite) {
        logError(`idInSite not found`);
        continue;
      }

      const item = {
        title,
        merchantName,
        idInSite,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = await processCoupon(item, element);

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

    if (nonExistingIds?.length == 0) return;

    let currentResult: ItemResult;

    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
      await makeRequest(currentResult.itemUrl, currentResult.validator);
    }
  } catch {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
// Handler function for processing coupon code
router.addHandler(Label.getCode, async (context) => {
  const { page, request, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    await page.waitForTimeout(5000); // Wait for 5 seconds

    await page.waitForSelector('.floating-box-content');

    log.info(`GetCode ${request.url}`);
    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const modal = await page.$('.floating-box-content');

    if (!modal) {
      log.warning('Coupon code input is missing');
    }

    const code = await page.$eval(
      '.code-box.code',
      (node) => node?.textContent
    );
    // Check if the code is found
    if (!code) {
      log.warning('Coupon code not found in the HTML content');
    }
    log.info(`Found code: ${code}\n    at: ${request.url}`);
    // Add the decoded code to the validator's data

    validator.addValue('code', code);

    await postProcess(
      {
        SaveDataHandler: {
          validator: validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
