import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  checkCouponIds,
  CouponHashMap,
  CouponItemResult,
  generateHash,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  // Extract the description
  const descElement = $cheerio('p.voucher-details');
  const description = descElement.length > 0 ? descElement.text().trim() : '';

  // Extract the code
  let code = '';
  const codeElement = $cheerio('span#coupon-code');

  if (codeElement.length > 0) {
    code = codeElement.text().trim();
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.merchantDomain);
  validator.addValue('title', couponItem.title);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (code) {
    validator.addValue('code', code);
  }

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  validator.addValue('idInSite', generatedHash);

  return { generatedHash, validator, hasCode: !!code, couponUrl: '' };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Listing ${request.url}`);

    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    const merchantNameElem = $('div.breadcrumbs span.breadcrumb_last');

    if (!merchantNameElem) {
      logError('Unable to find merchant name element');
      return;
    }

    const merchantName = merchantNameElem.text().trim();

    const merchantDomainTag = $('#shopinfo-3 .email');

    if (!merchantDomainTag) {
      log.warning(`merchantDomain not found in ${request.url}`);
    }
    const merchantDomain = merchantDomainTag.attr('href')?.split('@')?.[1];

    const validCoupons = $('ul#vouchers > li > div');

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
      const $coupon = cheerio.load(element);

      // Extract the voucher title
      const title = $coupon('h2')?.text()?.trim();

      if (!title) {
        logError('Voucher title is missing');
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
        // Add the generated hash to the list of IDs to check
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
        // Enqueue the coupon URL for further processing with appropriate label and validator data
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
