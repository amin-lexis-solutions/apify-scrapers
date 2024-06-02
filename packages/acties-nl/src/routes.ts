import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { decode } from 'html-entities';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  'X-Requested-With': 'XMLHttpRequest',
};

type Item = {
  isCoupon: boolean;
  isExpired: boolean;
  isExclusive: boolean;
  idInSite: string | undefined;
  title: string;
};

function processCouponItem(
  merchantName: string,
  merchantDomain: string,
  pageId: string,
  item: Item,
  sourceUrl: string
): CouponItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = item.idInSite;

  const hasCode = item.isCoupon;

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const couponUrl = hasCode
    ? `https://www.acties.nl/store-offer/ajax-popup/${idInSite}/${pageId}?_=${Date.now()}`
    : '';

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  // move to preprocess if it is present in all actors
  if (!crawler.requestQueue) {
    logError('Request queue is not initialized');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Check if valid page
    if (!$('#store-topbar').length) {
      // Send api request for this url
      logError(`Not Merchant URL: ${request.url}`);
      return;
    }
    // Extract the script content
    // Initialize variable to hold script content
    let scriptContent: string | undefined;

    // Convert the collection of script elements to an array and iterate
    const scripts = $('script').toArray();

    for (const script of scripts) {
      const scriptText = $(script).html();

      // Use a regular expression to check if this is the script we're looking for
      if (scriptText && scriptText.match(/window\.store = {.*?};/)) {
        scriptContent = scriptText;
        break; // Break the loop once we find the matching script
      }
    }

    // Ensure script content is present
    if (!scriptContent) {
      logError('Script tag with store data not found.');
      return;
    }

    // Use a regular expression to extract the JSON string
    const matches = scriptContent?.match(/window\.store = (.*?);/);

    if (!matches || matches.length <= 1) {
      logError('Could not find the store JSON data in the script tag.');
      return;
    }

    // Parse the JSON and extract the ID
    const jsonData = JSON.parse(matches?.[1]);
    const pageId = jsonData?.id;

    if (!pageId) {
      logError('Page ID is missing in the parsed JSON data.');
      return;
    }

    // Extract merchant name and domain
    const storeLogoElement = $('#store-logo');
    const merchantName = storeLogoElement.attr('title')?.trim();

    if (!merchantName) {
      logError(`merchantName not found ${request.url}`);
      return;
    }

    // Parsing domain from Link tag
    const domain = getMerchantDomainFromUrl(
      `https://${$('.right ul .link span')?.text()}`
    );
    // Check if the domain starts with 'www.' and remove it if present

    if (!domain) {
      // Send api request to disable scraping for this url
      log.warning(`merchantDomain not found for ${request.url}`);
    }

    // Extract coupons and offers
    const items: Item[] = [];

    $('article[data-offer-id]').each((index, element) => {
      const elementClass = $(element).attr('class') || '';

      // Skip if it's a historic coupon
      if (elementClass.includes('historic-coupon')) {
        return;
      }

      // Determine if the article is a coupon and if it's expired
      const isCoupon = elementClass.includes('coupon');
      const isExpired = elementClass.includes('expired');

      // Check for exclusivity only if it's a coupon
      let isExclusive = false;
      if (isCoupon) {
        const couponTagText = $(element)
          .find('div.details > div.coupon-tag')
          .text()
          .toLowerCase();
        isExclusive = couponTagText.includes('exclusieve');
      }

      // Extract the offer ID and title
      const idInSite = $(element).attr('data-offer-id');

      const title = $(element).find('h3').text().trim();

      items.push({
        isCoupon,
        isExpired,
        isExclusive,
        idInSite,
        title,
      });
    });

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: items,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    // Process each voucher
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const item of items) {
      await sleep(1000); // Sleep for 3 seconds between requests to avoid rate limitings

      if (!item.idInSite) {
        logError(`idInSite not found for coupon`);
        continue;
      }

      if (!item.title) {
        logError(`Coupon title not found`);
        continue;
      }

      result = processCouponItem(
        merchantName,
        domain,
        pageId,
        item,
        request.url
      );

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

    if (nonExistingIds.length == 0) return;

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
          headers: CUSTOM_HEADERS_LOCAL,
        },
        { forefront: true }
      );
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
    // Sleep for 3 seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Load the HTML content into Cheerio
    const $ = cheerio.load(htmlContent);

    // Extract the coupon code
    const rawCode = $('.code-box .code').text().trim();

    // Decode HTML entities
    const decodedCode = decode(rawCode);

    // Check if the code is found
    if (!decodedCode) {
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${decodedCode}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', decodedCode);

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
