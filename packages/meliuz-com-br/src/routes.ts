import cheerio from 'cheerio';
import * as he from 'he';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  checkExistingCouponsAnomaly,
  processAndStoreData,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  context: any,
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let titleCss = '';
  let codeCss = '';
  if (!isExpired) {
    titleCss = 'h3.offer-cpn__title';
    codeCss = 'span.code-btn__value';
  } else {
    titleCss = 'p';
    codeCss = 'span.expired-cpn-sec__code';
  }

  const idInSite = $coupon('*').first().attr('data-offer-id');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-offer-id attr is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon(titleCss).first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(
    titleElement
      .text()
      .trim()
      .replace(/[\s\t\r\n]+/g, ' ')
  );

  // Extract the voucher code
  const codeElement = $coupon(codeCss).first();
  let code = '';
  if (codeElement.length !== 0) {
    code = he.decode(
      codeElement
        .text()
        .trim()
        .replace(/[\s\t\r\n]+/g, ' ')
    );
    if (!code && !isExpired) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Voucher code is missing');
    }
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (code) {
    validator.addValue('code', code);
  }

  await processAndStoreData(validator, context);
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Extract the content of the meta tag
    const metaContent = $('meta[property="og:image:alt"]').attr('content');

    // Remove the word "Logotipo" from the extracted content
    const merchantName = metaContent
      ? metaContent.replace('Logotipo ', '')
      : '';

    // Check if valid page
    if (!merchantName) {
      console.log(`Not Merchant URL: ${request.url}`);
    } else {
      // Extract valid coupons
      const validCoupons = $('div.cpn-list__items > div[data-offer-id]');

      const hasAnomaly = await checkExistingCouponsAnomaly(
        request.url,
        validCoupons.length
      );

      if (hasAnomaly) {
        return;
      }

      for (let i = 0; i < validCoupons.length; i++) {
        const element = validCoupons[i];
        await processCouponItem(
          context,
          merchantName,
          false,
          element,
          request.url
        );
      }
      const expiredCoupons = $('ul.expired-cpn-sec__items > li[data-offer-id]');
      for (let i = 0; i < expiredCoupons.length; i++) {
        const element = expiredCoupons[i];
        await processCouponItem(
          context,
          merchantName,
          true,
          element,
          request.url
        );
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
