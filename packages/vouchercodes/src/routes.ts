import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  checkExistingCouponsAnomaly,
  getMerchantDomainFromUrl,
  processAndStoreData,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  domain: string | null,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  // Retrieve 'data-id' attribute
  const idInSite = $coupon.root().children().first().attr('data-id');

  // Check if 'data-id' is set and not empty
  if (!idInSite || idInSite.trim() === '') {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Missing or empty data-id attribute');
  }

  let hasCode = false;

  const elemCode = $coupon('span.code').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  // Extract the voucher title
  const titleElement = $coupon('div.details > h3').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the voucher description
  let description = '';
  const descrElement = $coupon('div.details > div.idetails').first();
  if (descrElement.length !== 0) {
    description = he.decode(descrElement.text().trim());
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (hasCode) {
    const coupon = elemCode.text().trim();
    validator.addValue('code', coupon);
  }
  await processAndStoreData(validator);
  return true;
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

    const merchantElem = $('ol.breadcrumb > li.active').first();

    const merchantName = he.decode(
      merchantElem ? merchantElem.text().trim() : ''
    );

    if (!merchantName) {
      log.warning('Merchant name is missing');
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

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, domain, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
