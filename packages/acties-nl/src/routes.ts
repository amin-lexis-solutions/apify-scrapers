import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { decode } from 'html-entities';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  sleep,
  generateCouponId,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  'X-Requested-With': 'XMLHttpRequest',
};

type Voucher = {
  isCoupon: boolean;
  isExpired: boolean;
  isExclusive: boolean;
  idInSite: string | undefined;
  title: string;
};

function processCouponItem(
  merchantName: string,
  domain: string,
  pageId: string,
  voucher: Voucher,
  sourceUrl: string
): CouponItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher.idInSite;

  if (!idInSite) {
    throw new Error('ID in site is missing');
  }

  const hasCode = voucher.isCoupon;

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', domain);
  validator.addValue('isExclusive', voucher.isExclusive);
  validator.addValue('isExpired', voucher.isExpired);
  validator.addValue('isShown', true);

  // Determine if the code needs to be fetched or data stored
  let couponUrl = '';
  if (hasCode) {
    // Get the code
    couponUrl = `https://www.acties.nl/store-offer/ajax-popup/${idInSite}/${pageId}?_=${Date.now()}`;
  }

  const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

  return { generatedHash, hasCode, couponUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is not initialized');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Check if valid page
    if (!$('#store-topbar').length) {
      console.log(`Not Merchant URL: ${request.url}`);
    } else {
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
        throw new Error('Script tag with store data not found.');
      }

      // Use a regular expression to extract the JSON string
      const matches = scriptContent.match(/window\.store = (.*?);/);
      if (!matches || matches.length <= 1) {
        throw new Error(
          'Could not find the store JSON data in the script tag.'
        );
      }

      // Parse the JSON and extract the ID
      const jsonData = JSON.parse(matches[1]);
      if (!jsonData || !jsonData.id) {
        throw new Error('Page ID is missing in the parsed JSON data.');
      }

      const pageId = jsonData.id;
      // console.log(`Page ID: ${pageId}`);

      // Extract merchant name and domain
      const storeLogoElement = $('#store-logo');
      const merchantNameAttr = storeLogoElement.attr('title');
      const merchantName = merchantNameAttr ? merchantNameAttr.trim() : null;
      // Extract domain from the text of the li element with the 'data-jump-store' attribute
      const domainRaw = $('div#store-topbar > div.right > ul > li > span')
        .text()
        .trim();

      // Check if the domain starts with 'www.' and remove it if present
      const domain = domainRaw.startsWith('www.')
        ? domainRaw.substring(4)
        : domainRaw;
      if (!merchantName) {
        throw new Error('Merchant name not found');
      }
      if (!domain) {
        throw new Error('Domain information not found');
      }
      // console.log(`Merchant Name: ${merchantName}, Domain: ${domain}`);

      // Extract coupons and offers
      const vouchers: Voucher[] = [];
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

        vouchers.push({
          isCoupon,
          isExpired,
          isExclusive,
          idInSite,
          title,
        });
      });

      // Process each voucher
      const couponsWithCode: CouponHashMap = {};
      const idsToCheck: string[] = [];
      let result: CouponItemResult;
      for (const voucher of vouchers) {
        await sleep(1000); // Sleep for 3 seconds between requests to avoid rate limitings

        result = processCouponItem(
          merchantName,
          domain,
          pageId,
          voucher,
          request.url
        );
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
      throw new Error('Coupon code not found in the HTML content');
    }

    console.log(`Found code: ${decodedCode}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', decodedCode);

    // Process and store the data
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
