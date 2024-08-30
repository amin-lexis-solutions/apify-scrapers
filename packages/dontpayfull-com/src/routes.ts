import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { generateItemId, getMerchantDomainFromUrl } from 'shared/helpers';
import { createPuppeteerRouter, sleep } from 'crawlee';
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
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    // Extract the merchant name
    const merchantName = await page.$eval('.sidebar-menu-box a', (a) =>
      a?.getAttribute('data-store')
    );
    // Throw an error if merchant name is not found
    if (!merchantName) {
      logger.error(`merchantName not found sourceUrl ${request.url}`);
      return;
    }
    // Extract coupon list elements from the webpage
    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('merchantDomain not found');
    }

    // Initialize variables
    let result: any;
    // Loop through each coupon element and process it

    for (const element of items) {
      const title = await element.$eval('h3', (title) =>
        title?.textContent?.trim()
      );

      if (!title) {
        logger.error(`coupon title not found`);
        continue;
      }

      const idInSite = await element.evaluate((node) =>
        node?.getAttribute('data-id')
      );

      if (!idInSite) {
        logger.error(`idInSite not found`);
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
        if (!result.itemUrl) continue;
        await enqueueLinks({
          urls: [result.itemUrl],
          userData: {
            ...request.userData,
            label: Label.getCode,
            validatorData: result.validator.getData(),
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
    await sleep(500); // delay popup shows code

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
