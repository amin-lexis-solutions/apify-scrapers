import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  generateItemId,
  ItemHashMap,
  checkItemsIds,
  ItemResult,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

// Add a handler for a specific label using router.addHandler()
router.addHandler(Label.listing, async (context) => {
  const { page, request, enqueueLinks } = context;
  // Check if the label in the request userData matches the label we're handling
  if (request.userData.label !== Label.listing) return;

  try {
    // Find all valid coupons on the page
    const items = await page.$$(
      'div[data-name="offer_strip"] a[data-component-class="offer_strip"]'
    );

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

    // Extract merchant name from the page
    const merchantName = await page.$eval('main picture img', (logo) => {
      const content = logo.getAttribute('alt');
      return content?.split(' ')[0];
    });
    // Throw an error if merchantName is not found
    if (!merchantName) {
      logError('merchan name not found');
      return;
    }
    // Extract domain from the request URL
    const merchantDomain = getMerchantDomainFromUrl(request.url);

    // Extract items
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    // Iterate over each valid coupon element
    for (const element of items) {
      // If element is null, skip to the next iteration
      if (!element) {
        continue;
      }

      // Initialize variables
      const isExpired = false;

      // Extract idInSite from href link
      const idInSite = await page.evaluate((node) => {
        const href = node?.getAttribute('href');
        const params = href ? new URLSearchParams(href) : null;
        return params?.get('offer_uuid');
      }, element);

      if (!idInSite) {
        logError(`idInSite not found in item`);
        continue;
      }

      // Check if the coupon has a code associated with it
      // it returns boolean | undefined
      const elementCode: boolean | undefined = await element.evaluate(
        (node) => {
          // element node may no appear
          return node?.textContent?.includes('Show Code');
        }
      );

      const hasCode = !!elementCode;

      // Extract title of the coupon
      const couponTitle = await page.evaluate((node) => {
        const titleElement = node?.querySelector('h3');
        return titleElement?.textContent?.replace('\n', '');
      }, element);

      if (!couponTitle) {
        logError(`title not found in item`);
        continue;
      }

      // Construct coupon URL
      const itemUrl = `https://www.retailmenot.com/view/${merchantDomain}?u=${idInSite}&outclicked=true`;

      // Create a DataValidator instance and populate it with coupon data
      const validator = new DataValidator();
      validator.addValue('domain', merchantDomain);
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', couponTitle);
      validator.addValue('idInSite', idInSite);
      validator.addValue('isExpired', isExpired);
      validator.addValue('isShown', true);

      // Generate a unique hash for the coupon using merchant name, unique ID, and request URL
      const generatedHash = generateItemId(merchantName, idInSite, request.url);
      // Create a result object containing generated hash, code availability, coupon URL, and validator data
      result = { generatedHash, hasCode, itemUrl, validator };
      // If the coupon has a code, store its details in the itemsWithCode object
      if (result.hasCode) {
        itemsWithCode[result.generatedHash] = result;
        // Add the generated hash to the list of IDs to check
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

    if (nonExistingIds.length == 0) return;

    for (const id of nonExistingIds) {
      const currentResult: ItemResult = itemsWithCode[id];

      if (!currentResult?.itemUrl) continue;
      // Enqueue the coupon URL for further processing with appropriate label and validator data
      await enqueueLinks({
        urls: [currentResult?.itemUrl],
        userData: {
          label: Label.getCode,
          validatorData: currentResult.validator,
        },
        forefront: true,
      });
    }
  } finally {
    // We don't catch errors explicitly so that they are logged in Sentry,
    // but we use finally to ensure proper cleanup and termination of the actor.
  }
});

// Add a handler for a specific label using router.addHandler()
router.addHandler(Label.getCode, async (context) => {
  const { page, request } = context;
  // Check if the label in the request userData matches the label we're handling
  if (request.userData.label !== Label.getCode) return;

  try {
    // Extract validatorData from request userData
    const validatorData = request.userData.validatorData;

    // Create a new instance of DataValidator
    const validator = new DataValidator();

    // Load validatorData into the validator instance
    validator.loadData(validatorData);

    // Remove a specific button from the page
    await page.$eval('div[x-show="outclicked"] div button', (node) =>
      node.remove()
    );

    // Extract the text content of a specific div from the page
    const code = await page.$eval('div[x-show="outclicked"] div', (code) =>
      code?.textContent?.trim()
    );

    // If code is extracted successfully, add it to the validator
    if (code) {
      validator.addValue('code', code);
    }

    // Process and store data using the validator
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch errors explicitly so that they are logged in Sentry,
    // but we use finally to ensure proper cleanup and termination of the actor.
  }
});
export { router };
