import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  getMerchantDomainFromUrl,
  logError,
  CouponHashMap,
  CouponItemResult,
  generateHash,
  checkCouponIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  const elementClass = $cheerio('*').first().attr('class');

  const isExpired = !!elementClass?.includes('expired');

  const elemCode = $cheerio('div span.btn-peel__secret').first();
  // Extract the description
  let description = '';
  const descElement = $cheerio(
    'div.promotion-term-extra-tab__detail-content'
  ).first();
  if (descElement.length > 0) {
    description = he
      .decode(descElement.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', couponItem.sourceUrl);
  validator.addValue('merchantName', couponItem.merchantName);
  validator.addValue('domain', couponItem.domain);
  validator.addValue('title', couponItem.title);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  const code = elemCode?.text()?.trim();

  const hasCode = code.length > 0;

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

    log.warning(`Processing URL: ${request.url}`);

    const merchantLink = $(
      'ol.breadcrumb > li:last-child > a.breadcrumb-item__link'
    );

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      logError('Merchant name is missing');
      return;
    }

    const domain = getMerchantDomainFromUrl(request.url);

    if (!domain) {
      log.warning('Domain is missing');
    }

    // Extract valid coupons
    const validCoupons = $('div.promotion-list__promotions > div');

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

    for (const item of validCoupons) {
      const $coupon = cheerio.load(item);

      const idInSite = $coupon('*')
        .attr('data-promotion-modal-link')
        ?.match(/\d+$/)?.[0];

      if (!idInSite) {
        logError(`Element data-promotion-id attr is missing in item`);
        continue;
      }

      // Extract the voucher title
      const title = $coupon('h3')?.first()?.text()?.trim();

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
    // Call the API to check if the coupon exists
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
