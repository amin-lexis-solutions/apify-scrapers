import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  getDomainName,
  formatDateTime,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  merchantName: string,
  domain: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  const idInSite = $coupon('*').first().attr('id')?.trim().split('-')[1];
  if (!idInSite) {
    throw new Error('Element id attr is missing or invalid');
  }

  let hasCode = false;
  let coupon = '';

  const couponAttr = $coupon('*').first().attr('data-payload');
  if (couponAttr && couponAttr.trim() !== '') {
    hasCode = true;
    coupon = couponAttr.trim();
  }

  let expiryDateAt = '';
  const timeElement = $coupon('time').first();
  if (timeElement.length > 0) {
    const datetimeAttr = timeElement.attr('datetime');
    if (datetimeAttr && datetimeAttr.trim() !== '') {
      expiryDateAt = formatDateTime(datetimeAttr);
    }
  }

  // Extract the voucher title
  const titleElement = $coupon('h3').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the description
  let description = '';
  const descElement = $coupon('div.term-collapse > div.inner').first();
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
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('expiryDateAt', expiryDateAt);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (hasCode) {
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

    const metaName = $('meta[itemprop="name"]');
    if (metaName.length === 0) {
      throw new Error('Meta name is missing');
    }

    const merchantName = he.decode(metaName.attr('content') || '');

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    // Extract domain from linlk element with itemprop="sameAs"
    const domainLink = $('link[itemprop="sameAs"]');

    if (domainLink.length === 0) {
      throw new Error('Domain link is missing');
    }

    const domain = getDomainName(domainLink.attr('content') || '');

    if (!domain) {
      throw new Error('Domain is missing');
    }

    // Extract valid coupons
    const validCoupons = $('div.view-content > div > article');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, domain, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
