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

import jp from 'jsonpath';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processItem(
  merchantName,
  countryCode,
  clientId,
  domain,
  voucher,
  sourceUrl
) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher?.idPool?.replace('us_', '');
  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', domain);
  validator.addValue('description', voucher.description);
  validator.addValue('termsAndConditions', voucher.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', voucher.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(merchantName, voucher.idPool, sourceUrl);

  const hasCode = voucher?.type === 'code';

  const itemUrl = `https://coupons.businessinsider.com/api/voucher/country/${countryCode}/client/${clientId}/id/${voucher.idPool}`;

  return { generatedHash, hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const jsonContent = await page.evaluate(
      () => document.querySelector('script[id="__NEXT_DATA__"]')?.textContent
    );

    const jsonData = JSON.parse(jsonContent || '{}');

    const currentItems = jp.query(jsonData, '$..pageProps.vouchers')?.[0] || [];
    const expiredItems =
      jp.query(jsonData, '$..pageProps.expiredVouchers')?.[0] || [];
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
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    const merchantName =
      jp.query(jsonData, '$..pageProps.retailer.name')[0] || null;
    const merchantUrl =
      jp.query(jsonData, '$..pageProps.retailer.merchant_url')[0] || null;
    const domain = getMerchantDomainFromUrl(merchantUrl);

    const clientId = jp.query(jsonData, '$..partnerId')[0] || null;
    const countryCode = jp.query(jsonData, '$..country')[0] || null;

    log.info(`Merchant Name: ${merchantName} - Domain: ${domain}`);

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    for (const item of items) {
      const result: ItemResult = processItem(
        merchantName,
        countryCode,
        clientId,
        domain,
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
      itemsWithCode[result.generatedHash] = result;
      idsToCheck.push(result.generatedHash);
    }

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
    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);
    // Get the json response from the API
    const jsonContent = await page.$eval('pre', (pre) => pre?.textContent);

    // Parse the JSON response
    const jsonData = JSON.parse(jsonContent || '{}');

    // Get the code value from the JSON response
    const code = jp.query(jsonData, '$..code')[0] || null;

    if (!code) {
      log.error('No code found');
      return;
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
