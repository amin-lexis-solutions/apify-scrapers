import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  getMerchantDomainFromUrl,
  generateItemId,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
  formatDateTime,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

declare global {
  interface Window {
    __NEXT_DATA__?: any; // You can replace `any` with a more specific type if you have one
  }
}

function checkItemCode(code: string | null | undefined) {
  // Trim the code to remove any leading/trailing whitespace
  const trimmedCode = code?.trim();

  // Check if the code is null or an empty string after trimming
  if (!trimmedCode) {
    return {
      isEmpty: true,
      code: '',
      startsWithDots: false,
    };
  }

  // Check if the trimmed code starts with '...'
  if (trimmedCode.startsWith('...')) {
    return {
      isEmpty: false,
      code: trimmedCode,
      startsWithDots: true,
    };
  }

  // Check if the trimmed code is shorter than 5 characters
  if (trimmedCode.length < 5) {
    return {
      isEmpty: false,
      code: trimmedCode,
      startsWithDots: true, // This is not a typo, it's intentional
    };
  }

  // If the code is not empty and does not start with '...', it's a regular code
  return {
    isEmpty: false,
    code: trimmedCode,
    startsWithDots: false,
  };
}

function processItem(
  merchantName: string,
  merchantDomain: string,
  retailerId: string,
  item: any,
  sourceUrl: string
): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite =
    item?.idVoucher?.toString() || item?.idPool?.replace('uk_', '');

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

  // code must be checked to decide the next step
  const codeType = checkItemCode(item.code);

  // Add the code to the validator
  let hasCode = false;
  let itemUrl = '';
  if (!codeType.isEmpty) {
    if (!codeType.startsWithDots) {
      validator.addValue('code', codeType.code);
    } else {
      hasCode = true;
      const idPool = item.idPool;
      itemUrl = `https://discountcode.dailymail.co.uk/api/voucher/country/uk/client/${retailerId}/id/${idPool}`;
    }
  }

  const generatedHash = generateItemId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, itemUrl, validator };
}

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.listing, async (context) => {
  const { page, request, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    log.warning(`Processing URL: ${request.url}`);

    await page.waitForFunction(() => {
      return !!window.__NEXT_DATA__;
    });

    const htmlContent = await page.content();
    const jsonPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
    const match = htmlContent.match(jsonPattern);

    let jsonData;

    if (!match || !match?.[1]) {
      logger.error(`'JSON data not found ${request.url}`);
      return;
    }

    jsonData = JSON.parse(match[1]);

    const retailerId = jsonData.query.clientId;
    jsonData = jsonData.props.pageProps;

    if (!jsonData.retailer) {
      logger.error('Retailer data is missing in the parsed JSON');
      return;
    }

    log.info(
      `\n\nFound ${jsonData.vouchers.length} active vouchers and ${jsonData.expiredVouchers.length} expired vouchers\n    at: ${request.url}\n`
    );

    const merchantName = jsonData.retailer.name;

    if (!merchantName) {
      logger.error(`not merchantName found ${request.url}`);
      return;
    }
    const merchantUrl = jsonData.retailer.merchant_url;
    const merchantDomain = getMerchantDomainFromUrl(merchantUrl);

    if (!merchantDomain) {
      log.warning(`not merchantDomain found`);
    }

    const currentItems = jsonData.vouchers.map((voucher) => ({
      ...voucher,
      is_expired: false,
    }));
    const expiredItems = jsonData.expiredVouchers.map((voucher) => ({
      ...voucher,
      is_expired: true,
    }));

    const items = [...currentItems, ...expiredItems];

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            items,
          },
        },
        context
      );
    } catch (error: any) {
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      result = processItem(
        merchantName,
        merchantDomain,
        retailerId,
        item,
        request.url
      );

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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }

    // Call the API to check if the coupon exists
    const nonExistingIds = await checkItemsIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;
    let validatorData;
    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
      validatorData = currentResult.validator.getData();
      if (!currentResult.itemUrl) continue;
      await enqueueLinks({
        urls: [currentResult.itemUrl],
        userData: {
          label: Label.getCode,
          validatorData,
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
  const { page, request, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    const validatorData = request.userData.validatorData;

    const validator = new DataValidator();

    validator.loadData(validatorData);

    const htmlContent = await page.content();
    const jsonPattern = /<pre[^>]*>(.*?)<\/pre>/s;
    const match = htmlContent.match(jsonPattern);

    if (!match || !match[1]) {
      log.warning('No matching pre tag found or no JSON content present');

      return;
    }

    const jsonCodeData = JSON.parse(match[1]);
    const code = jsonCodeData?.code;

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    validator.addValue('code', code);

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
