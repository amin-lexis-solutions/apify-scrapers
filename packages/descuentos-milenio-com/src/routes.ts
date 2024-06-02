import * as cheerio from 'cheerio';
import { createCheerioRouter, Dataset } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  generateHash,
  logError,
  checkCouponIds,
  CouponItemResult,
  CouponHashMap,
  getMerchantDomainFromUrl,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

// Define a function to check if the page matches the selectors
function isIndexPage(
  $: cheerio.Root,
  indexPageSelectors: string[],
  nonIndexPageSelectors: string[]
): boolean {
  const isIndexPage = indexPageSelectors.some(
    (selector) => $(selector).length > 0
  );
  const isNonIndexPage = nonIndexPageSelectors.some(
    (selector) => $(selector).length > 0
  );

  return isIndexPage && !isNonIndexPage;
}

async function processCouponItem(couponItem: any, $coupon: cheerio.Root) {
  // Extract the description
  const description = $coupon('div.card-primary__description')?.text();

  // Extract the code
  const code = $coupon('p.code')?.text();

  const dataId = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', dataId);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  return { generatedHash: dataId, validator, couponUrl: '', hasCode: !!code };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Processing URL: ${request.url}`);
    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    // Check if this is an index page
    const indexPageSelectors = ['.brand-index_content-main', '.brand-index']; // Add selectors that are present on the index page
    const nonIndexPageSelectors = ['.home-index']; // Add selectors that are present on the other page

    if (!isIndexPage($, indexPageSelectors, nonIndexPageSelectors)) {
      log.info(`Skip URL: ${request.url} - Not a data page`);
      await Dataset.pushData({
        __isNotIndexPage: true,
        __url: request.url,
      });
      return;
    }

    let merchantName = $(
      'section.brand-index_content-heading-block a img'
    ).attr('title');

    if (!merchantName) {
      logError('Unable to find merchant name');
      return;
    }

    const merchantUrl = $(`.brand-index_content-sidebar a`)
      ?.first()
      ?.attr(`href`);

    if (!merchantUrl) {
      logError(`Merchant domain not found ${request.url}`);
      return;
    }

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    if (!merchantDomain) {
      log.warning('merchantDomain not found');
    }

    merchantName = merchantName?.replace('Descuentos', '')?.trim();

    // Refactor to use a loop for valid coupons
    const validCoupons = $('ul.main-section_discounts li div.card-primary');

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

    // Extract valid coupons
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const element of validCoupons) {
      const $coupon = cheerio.load(element);

      const title = $coupon('div.card-primary__title')?.first()?.text()?.trim();

      if (!title || title.length == 0) {
        logError('title not found in item');
        continue;
      }

      const couponItem = {
        title,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = await processCouponItem(couponItem, $coupon);

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
        // Process and store the data
        await postProcess(
          {
            SaveDataHandler: {
              validator: currentResult.validator,
            },
          },
          context
        );
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
