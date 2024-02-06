import cheerio from 'cheerio';
import { RequestProvider } from 'crawlee';
import * as he from 'he';
import { DataValidator } from './data-validator';
import { Label, CUSTOM_HEADERS } from './constants';
import { processAndStoreData } from './utils';

export function extractDomainFromUrl(url: string): string {
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

export async function processCouponItem(
  requestQueue: RequestProvider,
  merchantName: string,
  domain: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

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

  const idInSite = $coupon('*').first().attr('data-promotion-id');
  if (!idInSite) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element data-promotion-id attr is missing');
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
    // Add the coupon URL to the request queue
    await requestQueue.addRequest(
      {
        url: `https://www.bargainmoose.ca/coupons/promotions/modal/${idInSite}`,
        userData: {
          label: Label.getCode,
          validatorData: validator.getData(),
        },
        headers: CUSTOM_HEADERS,
      },
      { forefront: true }
    );
  } else {
    await processAndStoreData(validator);
  }
}
