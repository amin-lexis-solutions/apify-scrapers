import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  generateCouponId,
  CouponHashMap,
  checkCouponIds,
  CouponItemResult,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.listing, async (context) => {
  const { page, request, enqueueLinks, log } = context;

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
    log.info(`Listing ${request.url}`);

    await page.waitForSelector('.-grid');

    const merchantName = await getMerchantName(page);

    if (!merchantName) {
      logError('merchan name not found');
      return;
    }

    const validCoupons = await page.$$('.-horizontal.m-offer');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: validCoupons,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
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

      if (!couponTitle) {
        logError(`not couponTitle found in item`);
        continue;
      }

      if (codeElement) {
        idInSite = await element.evaluate(
          (block) =>
            block.getAttribute('data-offer-id') ||
            block.getAttribute('id')?.split('r')?.[1]
        );
      }

      const validator = new DataValidator();

      validator.addValue('merchantName', merchantName);
      validator.addValue('title', couponTitle);
      validator.addValue('sourceUrl', request.url);
      validator.addValue('isShown', true);
      validator.addValue('isExpired', false);

      if (!idInSite) {
        logError(`not idInSite found in item`);
        continue;
      }

      idInSite = await extractIdInSite(element);
      validator.addValue('idInSite', idInSite);

      const couponUrl = `https://www.poulpeo.com/o.htm?c=${idInSite}`;

      const generatedHash = generateCouponId(
        merchantName,
        idInSite,
        request.url
      );

      const hasCode = !!codeElement;

      result = { generatedHash, hasCode, couponUrl, validator };

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

router.addHandler(Label.getCode, async (context) => {
  const { page, request, log } = context;

  if (request.userData.label !== Label.getCode) return;

  log.info(`GetCode ${request.url}`);

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
