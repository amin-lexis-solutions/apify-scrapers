import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  generateItemId,
  ItemHashMap,
  checkItemsIds,
  ItemResult,
  getMerchantDomainFromUrl,
  logError,
  formatDateTime,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.listing, async (context) => {
  const { page, request, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  async function getCouponTitle(element) {
    return await element.$eval('.title', (node) => node?.textContent);
  }

  async function extractExpireDate(element) {
    // 1. Get the text content of the element with class 'time_success'
    const inputString = await element.$eval('.time_success', (node) =>
      node?.innerText?.trim()
    );

    // 2. Check if the content is empty or undefined and return if so
    if (!inputString) {
      return;
    }

    // Regular expression to match the date in the format MM-DD-YY
    const regex = /\b\d{2}-\d{2}-\d{2}\b/g;

    // Extracting the date from the string
    const match = inputString.match(regex);

    // Output the matched date
    if (match) {
      const formatDate = new Date(match[0]).toLocaleDateString();
      return formatDate;
    } else {
      return;
    }
  }

  async function extractIdInSite(element) {
    return await element.$eval('.card_box', (selector) => {
      const url = selector?.getAttribute('href');
      const regex = /\/voucher\/(\d+)\.html/;

      // Extracting the code from the URL
      const match = url?.match(regex);
      // Output the matched code
      if (match) {
        const code = match[1]; // The captured code is in the first capturing group
        return code;
      } else {
        return selector?.querySelector('data-cid');
      }
    });
  }

  async function getItemUrl(merchantName, id) {
    return `https://www.drivereasy.com/coupons/${merchantName.replace(
      ' ',
      '-'
    )}?promoid=${id}`;
  }

  try {
    log.info(`Listing ${request.url}`);

    const items = await page.$$('.list_coupons li .offer_card');

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

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    const merchantName = await page.$eval('.m_logo img', (node) =>
      node.getAttribute('alt')
    );

    if (!merchantName) {
      logError('merchan name not found');
      return;
    }

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const element of items) {
      const hasCode = true;

      const title = await getCouponTitle(element);

      if (!title) {
        logError('idInSite not found in item');
        continue;
      }

      const idInSite = await extractIdInSite(element);

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      const itemUrl = await getItemUrl(merchantName, idInSite);
      const expireDate = await extractExpireDate(element);

      const validator = new DataValidator();
      // Add required and optional values to the validator
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('domain', merchantDomain);

      validator.addValue('title', title);
      validator.addValue('idInSite', idInSite);
      validator.addValue('isExpired', false);
      validator.addValue('isShown', true);

      if (expireDate) {
        validator.addValue('expiryDateAt', formatDateTime(expireDate));
      }

      const generatedHash = generateItemId(merchantName, idInSite, request.url);

      result = { generatedHash, hasCode, itemUrl, validator };

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

    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;

    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];

      if (!currentResult.itemUrl) continue;
      // Add the coupon URL to the request queue
      await enqueueLinks({
        urls: [currentResult.itemUrl],
        userData: {
          label: Label.getCode,
          validatorData: currentResult.validator.getData(),
        },
        forefront: true,
      });
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  const { request, page, log } = context;

  if (request.userData.label !== Label.getCode) return;

  await page.waitForSelector('.coupon_detail_pop');

  try {
    log.info(`GetCode ${request.url}`);
    // 1. Extract validator data and create a new validator object
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // 2. Asynchronously extract code from the page
    const code = await page.evaluate(
      () => document.querySelector('#codeText')?.textContent
    );

    if (!code?.includes('Sign+up')) {
      validator.addValue('code', code);
    }

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

export { router };
