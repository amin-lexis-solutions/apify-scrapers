import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  getMerchantDomainFromUrl,
  logError,
  generateHash,
  CouponItemResult,
  CouponHashMap,
  checkCouponIds,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processCouponItem(couponItem: any, $cheerio: cheerio.Root) {
  let startDateAt = '';
  let expiryDateAt = '';

  const startDateAttr = $cheerio
    .root()
    .children()
    .first()
    .attr('data-start_date');
  if (startDateAttr && startDateAttr.trim()) {
    startDateAt = formatDateTime(startDateAttr);
  }

  const expiryDateAttr = $cheerio
    .root()
    .children()
    .first()
    .attr('data-end_date');
  if (expiryDateAttr && expiryDateAttr.trim()) {
    expiryDateAt = formatDateTime(expiryDateAttr);
  }

  const code = $cheerio('.couponCode').text();

  // Extract the description
  let description = '';
  const descElement = $cheerio('div.vouchdescription > ul').first();
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
  validator.addValue('description', description);
  validator.addValue('idInSite', couponItem.idInSite);
  validator.addValue('expiryDateAt', expiryDateAt);
  validator.addValue('startDateAt', startDateAt);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const hasCode = !!code;

  hasCode ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    couponItem.merchantName,
    couponItem.title,
    couponItem.sourceUrl
  );

  return { generatedHash, hasCode, validator, couponUrl: '' };
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

    const merchantNameEncoded = $('div.Breadcrumb > div.container_center')
      .contents()
      .filter((i, element) => {
        // element.type === 'text' ensures the node is a text node
        // $.trim($(element).text()) checks if the text is non-empty when trimmed
        return element.type === 'text' && $(element).text().trim() !== '';
      })
      .first()
      .text()
      .trim();

    const merchantName = he.decode(merchantNameEncoded);

    if (!merchantName) {
      logError(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantUrl = $('.icon_globe a')?.attr('href');

    const domain = merchantUrl ? getMerchantDomainFromUrl(merchantUrl) : null;

    if (!domain) {
      log.warning('domain name is missing');
    }
    // Extract valid coupons
    const validCoupons = $('div.rect_shape > div.company_vocuher');

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
      // Extract the voucher title
      const title = $coupon('h3')?.first()?.text()?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const idInSite = $coupon('h3').attr('data-rel')?.match(/\d+$/)?.[0];

      if (!idInSite) {
        logError('idInSite not found in item');
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
