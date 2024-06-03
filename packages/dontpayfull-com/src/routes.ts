import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  generateCouponId,
  CouponHashMap,
  checkCouponIds,
  CouponItemResult,
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
    couponItem: any,
    element: ElementHandle<HTMLLIElement>
  ) {
    const hasCode = !!(await element.evaluate((node) => {
      const attr = node?.getAttribute('data-coupon');
      return attr;
    }));
    // Create a data validator instance
    const validator = new DataValidator();
    // Add required and optional values to the validator
    validator.addValue('merchantName', couponItem.merchantName);
    validator.addValue('domain', couponItem.merchantDomain);
    validator.addValue('title', couponItem.title);
    validator.addValue('sourceUrl', couponItem.sourceUrl);
    validator.addValue('idInSite', couponItem.idInSite);

    validator.addValue('isShown', true);
    validator.addValue('isExpired', false);
    // Generate a hash for the coupon
    const generatedHash = generateCouponId(
      couponItem.merchantName,
      couponItem.idInSite,
      couponItem.sourceUrl
    );

    const couponUrl = `https://www.dontpayfull.com/at/${couponItem.domain}?c=${couponItem.idInSite}#c${couponItem.idInSite}`;

    return { generatedHash, hasCode, couponUrl, validator };
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

    const couponList = await page.$$('#active-coupons li.obox.code');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: couponList,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: any;
    // Loop through each coupon element and process it

    for (const element of couponList) {
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

      const couponItem = {
        title,
        merchantName,
        idInSite,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = await processCoupon(couponItem, element);

      if (result.hasCode) {
        couponsWithCode[result.generatedHash] = result;
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
    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds?.length == 0) return;

    let currentResult: CouponItemResult;

    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
      await makeRequest(currentResult.couponUrl, currentResult.validator);
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
