import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  getDomainName,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

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
  const voucherTitle = couponItem.title;

  const idInSite = couponItem.voucher.id.split(':')[3]; // value is like ":hinge:vouchers:123456"

  let hasCode = couponItem.voucher.hasVoucherCode;

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
  validator.addValue('title', voucherTitle);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isShown', true);

  let couponUrl = '';
  if (hasCode) {
    if (code !== null && code.trim() !== '') {
      validator.addValue('code', code);
      hasCode = false;
    } else {
      couponUrl = `https://www.sparwelt.de/hinge/vouchercodes/${idInSite}`;
    }
  }

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context
    console.log(`\nProcessing URL: ${request.url}`);

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
      console.log(
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
      domain = getDomainName(
        offers[0].node.partnerShoppingShop.shoppingShop.domainUrl
      );
    } else if (jsonData.data.vouchers && jsonData.data.vouchers.length > 0) {
      noNode = true;
      offers = jsonData.data.vouchers as OfferNode[];
      merchantName = jsonData.data.vouchers[0].partnerShoppingShop.title;
      domain = getDomainName(
        jsonData.data.vouchers[0].partnerShoppingShop.shoppingShop.domainUrl
      );
    } else {
      console.log(`No offers found: ${request.url}`);
      return;
    }
    console.log(`Found ${offers.length} offers`);

    if (!merchantName) {
      console.log(`Merchant name not found: ${request.url}`);
      return;
    }

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      offers.length
    );

    if (hasAnomaly) {
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    for (const item of offers) {
      const offerNode: OfferNode = noNode ? item : item.node;
      result = processCouponItem(merchantName, domain, offerNode, request.url);
      if (!result.hasCode) {
        await processAndStoreData(result.validator);
      } else {
        couponsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
      }
    }

    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds.length > 0) {
      let currentResult: CouponItemResult;
      for (const id of nonExistingIds) {
        currentResult = couponsWithCode[id];
        // Add the coupon URL to the request queue
        await crawler.requestQueue.addRequest(
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
  const { request, body } = context;

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
      throw new Error('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.voucher_code;
    console.log(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
