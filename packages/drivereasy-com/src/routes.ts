import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  generateCouponId,
  CouponHashMap,
  checkCouponIds,
  CouponItemResult,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.listing, async ({ page, request, enqueueLinks }) => {
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
  async function getCouponUrl(domain, id) {
    return `https://www.drivereasy.com/coupons/${domain}?promoid=${id}`;
  }
  async function extractDomainFromUrl(url: string) {
    const u = new URL(url);
    const lastPathname = u?.pathname?.split('/').pop();
    return lastPathname;
  }

  try {
    await page.waitForSelector('.list_coupons li');

    const domain = await extractDomainFromUrl(request.url);

    const merchantName = await page.$eval('.m_logo img', (node) =>
      node.getAttribute('alt')
    );

    if (!merchantName) {
      throw new Error('merchan name not found');
    }

    const validCoupons = await page.$$('.list_coupons li .offer_card');

    // Extract validCoupons

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const element of validCoupons) {
      const hasCode = true;

      const title = await getCouponTitle(element);
      const idInSite = await extractIdInSite(element);

      if (!idInSite) {
        throw new Error('idInSite not found');
      }

      const couponUrl = await getCouponUrl(domain, idInSite);
      const expireDate = await extractExpireDate(element);

      const validator = new DataValidator();
      // Add required and optional values to the validator
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', title);
      validator.addValue('idInSite', idInSite);
      validator.addValue('isExpired', false);
      validator.addValue('isShown', true);

      if (expireDate) {
        validator.addValue('expiryDateAt', expireDate);
      }

      const generatedHash = generateCouponId(
        merchantName,
        idInSite,
        request.url
      );

      result = { generatedHash, hasCode, couponUrl, validator };

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
        await enqueueLinks({
          urls: [currentResult.couponUrl],
          userData: {
            label: Label.getCode,
            validatorData: currentResult.validator.getData(),
          },
          forefront: true,
        });
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async ({ page, request }) => {
  if (request.userData.label !== Label.getCode) return;

  await page.waitForSelector('.coupon_detail_pop');

  try {
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

    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
