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

  async function getMerchantName(page) {
    return await page.evaluate(() => {
      const name = document.querySelector('.m-pageHeader__title')?.textContent;
      return name;
    });
  }

  async function makeRequest(couponUrl, validatorData) {
    await enqueueLinks({
      urls: [couponUrl],
      userData: {
        label: Label.getCode,
        validatorData,
      },
      forefront: true,
    });
  }

  async function extractIdInSite(element) {
    return await element.evaluate((selector) =>
      selector.getAttribute('data-offer-id')
    );
  }

  try {
    await page.waitForSelector('.-grid');

    const merchantName = await getMerchantName(page);

    if (!merchantName) {
      throw new Error('merchan name not found');
    }

    const validCoupons = await page.$$('.-horizontal.m-offer');

    if (!validCoupons) {
      throw new Error('Valid coupons not found');
    }

    // Extract validCoupons

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const element of validCoupons) {
      const codeElement = await element.$(
        '.m-offer__action .a-btnSlide__truncateCode'
      );
      let idInSite;

      const couponTitle = await element.evaluate(
        (node) => node.querySelector('.m-offer__title')?.textContent
      );

      if (codeElement) {
        idInSite = await element.evaluate((block) =>
          block.getAttribute('data-offer-id')
        );
      }

      const validator = new DataValidator();

      validator.addValue('merchantName', merchantName);
      validator.addValue('title', couponTitle);
      validator.addValue('sourceUrl', request.url);
      validator.addValue('isShown', true);
      validator.addValue('isExpired', false);

      let couponUrl = '';

      if (!idInSite) continue;

      idInSite = await extractIdInSite(element);
      validator.addValue('idInSite', idInSite);

      couponUrl = `https://www.poulpeo.com/o.htm?c=${idInSite}`;

      const generatedHash = generateCouponId(
        merchantName,
        idInSite,
        request.url
      );
      const hasCode = codeElement ? true : false;

      result = { generatedHash, hasCode, couponUrl, validator };

      if (result.hasCode) {
        couponsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
      } else {
        await processAndStoreData(result.validator);
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds?.length === 0) return;

    let currentResult: CouponItemResult;

    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
      // Add the coupon URL to the request queue
      await makeRequest(currentResult.couponUrl, currentResult.validator);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async ({ page, request }) => {
  if (request.userData.label !== Label.getCode) return;

  await page.waitForSelector('#o-modal');

  try {
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const code = await page.evaluate(() =>
      document.querySelector('.coupon-panel #ic')?.getAttribute('value')
    );

    if (code) {
      validator.addValue('code', code);
    }

    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
