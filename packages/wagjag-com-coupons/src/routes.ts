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
  sourceUrl: string,
  index: number
) {
  const $coupon = cheerio.load(couponElement);

  const idInSite = $coupon('*').first().attr('data-promotion-id');
  if (!idInSite) {
    console.log(
      `Element data-promotion-id attr is missing in ${sourceUrl} , item #${index}`
    );
    return false;
  }

  let hasCode = false;

  let isExpired = false;

  const elementClass = $coupon('*').first().attr('class');
  if (!elementClass) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  isExpired = elementClass.includes('expired');

  const elemCode = $coupon('div span.btn-peel__secret').first();

  if (elemCode.length > 0) {
    hasCode = true;
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
  const descElement = $coupon(
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
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
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

    const merchantLink = $(
      'ol.breadcrumb > li:last-child > a.breadcrumb-item__link'
    );

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
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
    const validCoupons = $('div.promotion-list__promotions > div');
    for (let i = 0; i < validCoupons.length; i++) {
      const element = validCoupons[i];
      await processCouponItem(
        merchantName,
        domain,
        element,
        request.url,
        i + 1
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
