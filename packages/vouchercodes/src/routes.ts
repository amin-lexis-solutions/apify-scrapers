import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  checkCouponIds,
  CouponHashMap,
  CouponItemResult,
  generateHash,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  const elemCode = $cheerio('span.code').first();

  const hasCode = !!elemCode;

  // Extract the voucher description
  let description = '';
  const descrElement = $cheerio('div.details > div.idetails').first();
  if (descrElement.length !== 0) {
    description = he.decode(descrElement.text().trim());
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('description', description);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const code = elemCode?.text()?.trim();
  hasCode ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  return { generatedHash, validator, hasCode, couponUrl: '' };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantElem = $('ol.breadcrumb > li.active').first();

    const merchantName = he.decode(
      merchantElem ? merchantElem.text().trim() : ''
    );

    if (!merchantName) {
      logError('Merchant name is missing');
      return;
    }

    const merchantUrl = $('.contact .mail a')
      .attr('href')
      ?.replace('mailto:', '');

    const domain = merchantUrl ? getMerchantDomainFromUrl(merchantUrl) : null;

    if (!domain) {
      log.warning('Domain name is missing');
    }
    // Extract valid coupons
    const validCoupons = $('div#divMerchantOffers > div[data-id]');

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

    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let result: CouponItemResult;

    for (const element of validCoupons) {
      const $coupon = cheerio.load(element);

      // Retrieve 'data-id' attribute
      const idInSite = $coupon.root()?.children()?.first()?.attr('data-id');

      // Check if 'data-id' is set and not empty
      if (!idInSite) {
        logError('empty data-id attribute in item');
        continue;
      }

      // Extract the voucher title
      const title = $coupon('div.details > h3').first()?.text()?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const couponItem = {
        title,
        idInSite,
        merchantName,
        domain,
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

    const nonExistingIds = await checkCouponIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    let currentResult: CouponItemResult;
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
