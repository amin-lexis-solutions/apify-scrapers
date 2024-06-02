import { createPuppeteerRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  generateCouponId,
  getMerchantDomainFromUrl,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
} from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processCouponItem(merchantName, domain, voucher, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', voucher.idInSite);

  // Add optional values to the validator
  validator.addValue('domain', domain);
  validator.addValue('code', voucher.code);
  validator.addValue('isShown', true);

  const hasCode = voucher.code ? true : false;
  const generatedHash = generateCouponId(
    merchantName,
    voucher.idInSite,
    sourceUrl
  );

  return { generatedHash, hasCode, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, log } = context;
  if (request.userData.label !== Label.listing) return;

  // wait for the page to load completely
  await page.waitForSelector('.css-17m9sjs');

  try {
    const {
      merchantName,
      merchantSite,
    }: {
      merchantName: string | '';
      merchantSite: string | '';
    } = (await page.$eval('.css-17m9sjs a.css-1cvlksa', (a: any) => {
      return {
        merchantName: a.textContent || '',
        merchantSite: a.href || '',
      };
    })) || { merchantName: null, merchantSite: null };

    const domain = getMerchantDomainFromUrl(merchantSite);

    log.info(`Processing ${merchantName} coupons`);

    // load all the coupons by clicking the load more button
    let loadMoreButton;
    while ((loadMoreButton = await page.$('.css-1f2y3i5'))) {
      await loadMoreButton.click();
      await page
        .waitForSelector('.css-1f2y3i5', { timeout: 500 })
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        .catch(() => {});
    }

    // find all the coupons in #top-coupons section
    const topCoupons =
      (
        await page.$$eval('#top-coupons li.css-1etz4gb', (coupons) => {
          return coupons.map((coupon) => {
            const title =
              coupon.querySelector('h2 .css-7f3d9a')?.textContent || '';
            const code =
              coupon.querySelector('.css-198h9ap span.css-efj85z')
                ?.textContent || '';
            const idInSite = coupon.getAttribute('id') || '';
            if (!title) return null;
            return {
              title,
              idInSite,
              code,
            };
          });
        })
      ).filter((coupon) => coupon !== null) || [];

    // find all the coupons in the table
    const otherCoupons =
      (
        await page.$$eval('table.css-1kbncg9 tr', (coupons) => {
          return coupons.map((coupon) => {
            const title =
              coupon.querySelector('h2.css-1p8jodt')?.textContent || '';
            const code =
              coupon
                .querySelector('button.css-198rnhu')
                ?.getAttribute('title') || '';
            const idInSite = coupon.getAttribute('id') || '';
            if (!title) return null;
            return { title, idInSite, code };
          });
        })
      ).filter((coupon) => coupon !== null) || [];

    const couponList = [...topCoupons, ...otherCoupons];

    try {
      // Preprocess the data
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            coupons: couponList,
          },
        },
        context
      );
    } catch (error) {
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let processedData: any = {};

    // Loop through each coupon element and process it
    for (const coupon of couponList) {
      processedData = await processCouponItem(
        merchantName,
        domain,
        coupon,
        request.url
      );
      // If coupon has no code, process and store its data
      if (processedData.hasCode) {
        couponsWithCode[processedData.generatedHash] = processedData;
        idsToCheck.push(processedData.generatedHash);
        continue;
      }

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator: processedData.validator,
            },
          },
          context
        );
      } catch (error: any) {
        log.warning(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkCouponIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length == 0) return;

    let currentResult: CouponItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
      await postProcess(
        {
          SaveDataHandler: {
            validator: currentResult.validator,
          },
        },
        context
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
