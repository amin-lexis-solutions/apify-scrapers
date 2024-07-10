import { createPuppeteerRouter, sleep } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateCouponId,
  CouponItemResult,
  CouponHashMap,
  checkCouponIds,
  logError,
} from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processCouponItem(merchantName, merchantDomain, voucher, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher?.idInSite;
  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', voucher.description);
  validator.addValue('termsAndConditions', voucher.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', voucher.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateCouponId(
    merchantName,
    voucher.idPool,
    sourceUrl
  );

  const hasCode = voucher?.type === 'code';

  const couponUrl = voucher.couponUrl;

  return { generatedHash, hasCode, couponUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    let allItems: any[] = [];

    const getItems = async () => {
      const items = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.E6jjcn .Zc7IjY')).map(
          (item) => {
            const idInSite = item
              .querySelector('.wixui-repeater__item')
              ?.getAttribute('id')
              ?.split('__')[1];
            const merchantName = item
              .querySelector('div[title]')
              ?.getAttribute('title')
              ?.split(' ')?.[0];
            const title = item.querySelector('.wixui-rich-text__text')
              ?.firstChild?.textContent;
            const description = item.querySelector('p.wixui-rich-text__text')
              ?.textContent;
            const couponUrl = item
              .querySelector('a[data-testid=linkElement]')
              ?.getAttribute('href');

            return { idInSite, title, description, merchantName, couponUrl };
          }
        );
      });
      allItems = [...items, ...allItems];
    };

    const nextPageElement = await page.$("div a[aria-label='Next Page']");

    const nextPageDisabled = async () => {
      const isDisabled = await page.evaluate((node) => {
        return node?.getAttribute('aria-disabled');
      }, nextPageElement);

      if (!isDisabled) await nextPageElement?.click();

      return isDisabled;
    };

    while (nextPageElement) {
      await getItems();
      const isNextPageDisabled = await nextPageDisabled();
      if (isNextPageDisabled) break;
      await sleep(100);
    }

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            coupons: allItems,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error) {
      logError(`Preprocess Error: ${error}`);
      return;
    }

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];

    for (const item of allItems) {
      if (!item.merchantName) {
        logError(`Merchant name not found ${request.url}`);
        continue;
      }

      if (!item?.title) {
        logError('Coupon title not found in item');
        continue;
      }
      if (!item?.idInSite) {
        logError('idInSite not found in item');
        continue;
      }
      const result: CouponItemResult = processCouponItem(
        item.merchantName,
        null,
        item,
        request.url
      );

      if (!result.hasCode) {
        try {
          await postProcess(
            {
              SaveDataHandler: {
                validator: result.validator,
              },
            },
            context
          );
        } catch (error) {
          log.error(`Postprocess Error: ${error}`);
        }
        continue;
      }
      couponsWithCode[result.generatedHash] = result;
      idsToCheck.push(result.generatedHash);
    }

    // Check if the coupons already exist in the database
    const nonExistingIds = await checkCouponIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length == 0) return;

    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      const currentResult: CouponItemResult = couponsWithCode[id];
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
