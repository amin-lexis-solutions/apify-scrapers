import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

function extractDomainFromUrl(url: string): string {
  // Regular expression to extract the domain name
  const regex = /https?:\/\/[^/]+\/[^/]+\/([^/]+)/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Remove 'www.' if present
    if (matches[1].startsWith('www.')) {
      return matches[1].substring(4);
    }
    return matches[1];
  }

  return '';
}

async function processCouponItem(
  merchantName: string,
  domain: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  const idInSite = $coupon('*').first().attr('data-id');
  if (!idInSite) {
    console.log(`Element data-id attr is missing in ${sourceUrl}`);
    return false;
  }

  let hasCode = false;

  let isExpired = false;

  const elementClass = $coupon('*').first().attr('class');
  if (!elementClass) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  isExpired = elementClass.includes('expire-offer');

  const elemCode = $coupon('div[data-code]').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  // Extract the voucher title
  const titleElement = $coupon('div.h3 > a').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the voucher terms and conditions
  let termsAndConditions;
  const termsElement = $coupon('div[data-offer=conditions]').first();
  if (termsElement.length !== 0) {
    termsAndConditions = he.decode(termsElement.text().trim());
  } else {
    termsAndConditions = null;
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('termsAndConditions', termsAndConditions);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (hasCode) {
    const coupon = elemCode.attr('data-code');
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

    const pageH1Elem = $('h1.shop-page-title');

    const merchantName = he.decode(
      pageH1Elem ? pageH1Elem.text().replace('Codes promo ', '').trim() : ''
    );

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    // console.log(`Merchant Name: ${merchantName}`);

    const domain = extractDomainFromUrl(request.url);
    if (!domain) {
      throw new Error('Domain is missing');
    }
    // console.log(`Domain: ${domain}`);

    // Extract valid coupons
    const validCoupons = $('div.offer-list-item');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, domain, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
