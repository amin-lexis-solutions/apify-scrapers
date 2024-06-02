import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  getMerchantDomainFromUrl,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  logError,
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

function processCouponItem(
  merchantName: string,
  domain: string | null,
  couponItem: OfferNode,
  sourceUrl: string
): CouponItemResult {
  const idInSite = couponItem.voucher.id.split(':')[3];

  const hasCode = couponItem.voucher.hasVoucherCode;

  const code = couponItem.voucher.code;

  const isExclusive = couponItem.voucher.exclusive;

  let limitProduct = couponItem.voucher.limitProduct.trim();
  if (limitProduct === '') {
    limitProduct = 'keine';
  }

  let savingValue = '';
  if (couponItem.voucher.savingType === 1) {
    savingValue = `${couponItem.voucher.savingValue}%`;
  } else {
    savingValue = couponItem.voucher.savingValue;
  }

  const description = `Gutscheinwert: ${limitProduct}\nGilt für:\n    ${savingValue}\n    alle Kunden`;

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const couponUrl = code
    ? `https://www.sparwelt.de/hinge/vouchercodes/${idInSite}`
    : '';

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
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
      logError(
        `No matching script tag found or JSON parsing failed: ${request.url}`
      );
      return;
    }

    let offers;
    let merchantName: string;
    let domain: string | null;
    let noNode = false;

    if (jsonData.data.offers && jsonData.data.offers.length > 0) {
      offers = jsonData.data.offers as OfferItem[];
      merchantName = offers[0].node.partnerShoppingShop.title;
      domain = getMerchantDomainFromUrl(
        offers[0].node.partnerShoppingShop.shoppingShop.domainUrl
      );
    } else if (jsonData.data.vouchers && jsonData.data.vouchers.length > 0) {
      noNode = true;
      offers = jsonData.data.vouchers as OfferNode[];
      merchantName = jsonData.data.vouchers[0].partnerShoppingShop.title;
      domain = getMerchantDomainFromUrl(
        jsonData.data.vouchers[0].partnerShoppingShop.shoppingShop.domainUrl
      );
    } else {
      log.warning(`No offers found: ${request.url}`);
      return;
    }
    log.info(`Found ${offers.length} offers`);

    if (!merchantName) {
      log.info(`Merchant name not found: ${request.url}`);
      return;
    }

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: offers,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult | undefined;

    for (const item of offers) {
      const offerNode: OfferNode = noNode ? item : item.node;

      const title = offerNode?.title;

      if (!title) {
        logError('idInSite not found');
        continue;
      }

      if (!offerNode.voucher.id.split(':')[3]) {
        logError('idInSite not found in item');
        continue;
      }

      result = processCouponItem(merchantName, domain, offerNode, request.url);

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

    if (nonExistingIds.length > 0) {
      let currentResult: CouponItemResult;
      for (const id of nonExistingIds) {
        currentResult = couponsWithCode[id];
        // Add the coupon URL to the request queue
        await crawler?.requestQueue?.addRequest(
          {
            url: currentResult.couponUrl,
            userData: {
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
