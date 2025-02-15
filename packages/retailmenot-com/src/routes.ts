import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { ItemResult, getMerchantDomainFromUrl } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();
//TODO: Actor To Investigate later
// Add a handler for a specific label using router.addHandler()
router.addHandler(Label.listing, async (context) => {
  const { page, request, enqueueLinks } = context;
  // Check if the label in the request userData matches the label we're handling
  if (request.userData.label !== Label.listing) return;

  await page.setJavaScriptEnabled(true);

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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    // Extract merchant name from the page
    const merchantName = await page.$eval('main picture img', (logo) => {
      const content = logo.getAttribute('alt');
      return content?.split(' ')[0];
    });
    // Throw an error if merchantName is not found
    if (!merchantName) {
      logger.error('merchan name not found');
      return;
    }
    // Extract domain from the request URL
    const merchantDomain = getMerchantDomainFromUrl(request.url);

    // Extract items
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
        logger.error(`idInSite not found in item`);
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
        logger.error(`title not found in item`);
        continue;
      }

      const details = await page.evaluate(
        (node) => node?.parentElement?.querySelector('details'),
        element
      );

      await details?.click();

      const description = await page.evaluate(
        (node) =>
          node?.parentElement?.querySelector('details div')?.textContent,
        element
      );

      // Construct coupon URL
      const itemUrl = `https://www.retailmenot.com/view/${merchantDomain}?u=${idInSite}&outclicked=true`;

      // Create a DataValidator instance and populate it with coupon data
      const validator = new DataValidator();
      validator.addValue('domain', merchantDomain);
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('description', description);

      validator.addValue('title', couponTitle);
      validator.addValue('idInSite', idInSite);
      validator.addValue('isExpired', isExpired);
      validator.addValue('isShown', true);

      // Create a result object containing generated hash, code availability, coupon URL, and validator data
      result = { hasCode, itemUrl, validator };
      // If the coupon has a code, store its details in the itemsWithCode object
      if (result.hasCode) {
        if (!result?.itemUrl) continue;
        // Enqueue the coupon URL for further processing with appropriate label and validator data
        await enqueueLinks({
          urls: [result?.itemUrl],
          userData: {
            ...request.userData,
            label: Label.getCode,
            validatorData: result.validator,
          },
          forefront: true,
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
      } catch (error: any) {
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
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
