import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  processAndStoreData,
  sleep,
  getMerchantDomainFromUrl,
  generateItemId,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

interface OfferItem {
  cursor: string;
  node: OfferNode;
}

interface OfferNode {
  title: string;
  id: string;
  affiliateDeeplink: Deeplink;
  publicationStatus: number;
  voucher: Voucher;
  partnerShoppingShop: PartnerShoppingShop;
}

interface Deeplink {
  id: string;
  url: string;
}

interface Voucher {
  code: string | null;
  dateEnd: string | null;
  exclusive: boolean;
  hasVoucherCode: boolean;
  id: string;
  limitCustomer: string;
  limitProduct: string;
  minOrderValue: string;
  savingType: number;
  savingValue: string;
  title: string;
  updated: string;
  published: string;
  publicationStatus: number;
}

interface PartnerShoppingShop {
  id: string;
  title: string;
  slug: string;
  shoppingShop: ShoppingShop;
}

interface ShoppingShop {
  id: string;
  title: string;
  image: string;
  domainUrl: string;
}

function processItem(
  merchantName: string,
  merchantDomain: string | null,
  item: OfferNode,
  sourceUrl: string
): ItemResult {
  const idInSite = item.voucher.id.split(':')[3];

  const hasCode = item.voucher.hasVoucherCode;

  const code = item.voucher.code;

  const isExclusive = item.voucher.exclusive;

  let limitProduct = item.voucher.limitProduct.trim();
  if (limitProduct === '') {
    limitProduct = 'keine';
  }

  let savingValue = '';
  if (item.voucher.savingType === 1) {
    savingValue = `${item.voucher.savingValue}%`;
  } else {
    savingValue = item.voucher.savingValue;
  }

  const description = `Gutscheinwert: ${limitProduct}\nGilt für:\n    ${savingValue}\n    alle Kunden`;

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const itemUrl = code
    ? `https://www.sparwelt.de/hinge/vouchercodes/${idInSite}`
    : '';

  const generatedHash = generateItemId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context
    log.info(`Processing URL: ${request.url}`);

    let jsonData: any = null; // Consider defining a more specific type based on the expected structure of your JSON data

    $('script').each((index, element) => {
      const scriptElement = $(element);
      const scriptContent: string | null = scriptElement.html();

      if (scriptContent && scriptContent.startsWith('window.nuxt =')) {
        // Extract the JSON string
        const jsonString = scriptContent.replace('window.nuxt =', '').trim();
        try {
          jsonData = JSON.parse(jsonString);
        } finally {
          // We don't catch so that the error is logged in Sentry, but use finally
          // since we want the Apify actor to end successfully and not waste resources by retrying.
        }
      }
    });

    if (!jsonData) {
      logger.error(
        `No matching script tag found or JSON parsing failed: ${request.url}`
      );
      return;
    }

    let items;
    let merchantName: string;
    let merchantDomain: string | null;
    let noNode = false;

    if (jsonData.data.offers && jsonData.data.offers.length > 0) {
      items = jsonData.data.offers as OfferItem[];
      merchantName = items[0].node.partnerShoppingShop.title;
      merchantDomain = getMerchantDomainFromUrl(
        items[0].node.partnerShoppingShop.shoppingShop.domainUrl
      );
    } else if (jsonData.data.vouchers && jsonData.data.vouchers.length > 0) {
      noNode = true;
      items = jsonData.data.vouchers as OfferNode[];
      merchantName = jsonData.data.vouchers[0].partnerShoppingShop.title;
      merchantDomain = getMerchantDomainFromUrl(
        jsonData.data.vouchers[0].partnerShoppingShop.shoppingShop.domainUrl
      );
    } else {
      log.warning(`No items found: ${request.url}`);
      return;
    }
    log.info(`Found ${items.length} items`);

    if (!merchantName) {
      log.info(`Merchant name not found: ${request.url}`);
      return;
    }

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
    let result: ItemResult | undefined;

    for (const item of items) {
      const offerNode: OfferNode = noNode ? item : item.node;

      const title = offerNode?.title;

      if (!title) {
        logger.error('idInSite not found');
        continue;
      }

      if (!offerNode.voucher.id.split(':')[3]) {
        logger.error('idInSite not found in item');
        continue;
      }

      result = processItem(
        merchantName,
        merchantDomain,
        offerNode,
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

    if (nonExistingIds.length > 0) {
      let currentResult: ItemResult;
      for (const id of nonExistingIds) {
        currentResult = itemsWithCode[id];
        // Add the coupon URL to the request queue
        await crawler?.requestQueue?.addRequest(
          {
            url: currentResult.itemUrl,
            userData: {
              ...request.userData,
              label: Label.getCode,
              validatorData: currentResult.validator.getData(),
            },
            headers: CUSTOM_HEADERS,
          },
          { forefront: true }
        );
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Safely parse the JSON string
    let jsonCodeData;
    try {
      jsonCodeData = JSON.parse(htmlContent);
    } finally {
      // We don't catch so that the error is logged in Sentry, but use finally
      // since we want the Apify actor to end successfully and not waste resources by retrying.
    }
    // Validate the necessary data is present
    if (!jsonCodeData || !jsonCodeData.voucher_code) {
      log.warning('Code data is missing in the parsed JSON');
      return;
    }

    const code = jsonCodeData.voucher_code;
    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await processAndStoreData(validator, context);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
