import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { getDomainName, processAndStoreData } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  domain: string,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;
  const code = $coupon('*').first().attr('data-code')?.trim();
  if (code) {
    hasCode = true;
  }

  const idInSite = $coupon('*').first().attr('data-offerid');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-offerid attr is missing');
  }

  // Extract the voucher title
  const titleElement = $coupon('div.offerbox-store-title > p').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  // Extract the description
  let description = '';
  let descElement = $coupon('div.offerbox-store-title div.longtext').first();
  if (descElement.length === 0) {
    descElement = $coupon(
      'div.offerbox-store-title span.slutdatum:last-child'
    ).first();
  }
  if (descElement.length > 0) {
    description = he.decode(descElement.text()).trim();
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (hasCode) {
    validator.addValue('code', code);
  }

  // Process and store the data
  await processAndStoreData(validator);
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

    const merchantLink = $(
      'ol.breadcrumb > li:last-child > a > span[itemprop=name]'
    ).first();

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    const domain = getDomainName(request.url);

    if (!domain) {
      throw new Error('Domain name is missing');
    }
    // Extract valid coupons
    const validCoupons = $('div.active-offers-container div.offerbox-store');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, domain, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
