import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  getMerchantDomainFromUrl,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
};

function processCouponItem(
  merchantName: string,
  domain: string | null,
  couponElement: cheerio.Element,
  sourceUrl: string
): CouponItemResult {
  const $coupon = cheerio.load(couponElement);

  const validator = new DataValidator();

  const buttonElement = $coupon(
    'button[data-testid="VoucherShowButton"] > p'
  ).first();
  if (buttonElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Button element is missing');
  }

  const buttonText = buttonElement.text().trim();

  const hasCode = buttonText.toUpperCase().includes('ZUM GUTSCHEIN');

  const idInSite = $coupon('*').first().attr('data-voucherid');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-voucherid attr is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon(
    'button[class*="VouchersListItem_titleButton"]'
  ).first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('domain', domain);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  let couponUrl = '';
  if (hasCode) {
    // Extract country code from the URL with RegEx
    couponUrl = `https://www.gutscheinsammler.de/api/voucher/${idInSite}`;
  }
  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Selecting the script element containing json schema
    const scriptElement = $('script[data-testid="StoreSchemaOrg"]').first();

    if (scriptElement.length === 0) {
      throw new Error('Script element is missing');
    }

    // Parse the content of the script element
    const scriptContent = scriptElement.html();
    if (!scriptContent) {
      throw new Error('Script content is missing');
    }

    // Parse the script content as JSON
    const scriptJson = JSON.parse(scriptContent);

    const merchantName = scriptJson.name;

    const domain = getMerchantDomainFromUrl(scriptJson.sameAs);

    // Extract valid coupons
    const validCoupons = $(
      'section[data-testid=ActiveVouchers] div[data-testid=VouchersListItem]'
    );

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;
    for (const element of validCoupons) {
      result = processCouponItem(merchantName, domain, element, request.url);
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
            headers: CUSTOM_HEADERS_LOCAL,
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

    let code = '';

    // Attempt to parse the HTML content as JSON
    const parsedJson = JSON.parse(htmlContent);

    // Extract the "o_c" value
    if (
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      'code' in parsedJson
    ) {
      code = parsedJson['code'].trim();
      if (code) {
        console.log(`Found code: ${code}\n    at: ${request.url}`);
        validator.addValue('code', code);
      }
    }

    // Process and store the data
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
