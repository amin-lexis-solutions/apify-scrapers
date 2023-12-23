import cheerio from 'cheerio';
import { RequestProvider } from 'crawlee';
import * as he from 'he';
import { CUSTOM_HEADERS, Label } from './constants';
import { DataValidator } from './data-validator';
import { processAndStoreData } from './utils';

function extractAllText(elem: cheerio.Cheerio): string {
  let text = '';
  if (elem.length > 0) {
    text = he
      .decode(elem.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  return text.trim();
}

export function generateSitemapRequests(effectiveTestLimit: number) {
  const sitemapRequests: any[] = [];
  let characters = '0abcdefghijklmnopqrstuvwxyz';
  if (effectiveTestLimit > 0) {
    characters = '0';
  }

  for (const char of characters) {
    sitemapRequests.push({
      url: `https://www.lovecoupons.com.sg/sitemap-${char}.xml`,
      label: Label.sitemap,
      userData: {
        testLimit: effectiveTestLimit,
      },
    });
  }

  return sitemapRequests;
}

export async function processCouponItem(
  requestQueue: RequestProvider,
  merchantName: string,
  domain: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  const attrDataType = $coupon('*').first().attr('data-type');
  if (!attrDataType) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Attr data-type is missing');
  }

  let hasCode = false;
  if (attrDataType === '2') {
    hasCode = true;
  }

  const attrDataId = $coupon('*').first().attr('data-id');
  if (!attrDataId) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Attr data-id is missing');
  }

  const idInSite = attrDataId.trim();

  let couponUrl = '';
  if (hasCode) {
    const attrDataOut = $coupon('*').first().attr('data-out');
    if (!attrDataOut) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Attr data-out is missing');
    }
    couponUrl = new URL(attrDataOut.trim(), sourceUrl).href.replace(
      '/go/2/',
      '/go/3/'
    );
  }

  // Extract the voucher title
  const titleElement = $coupon('article header > h2').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = extractAllText(titleElement);

  if (!voucherTitle) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is empty');
  }

  // Extract the description
  const descrElement = $coupon('article header > p').first();
  const description = extractAllText(descrElement);

  // Extract terms and conditions
  const tocElement = $coupon('div.TermsConditions').first();
  const toc = extractAllText(tocElement);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('termsAndConditions', toc);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (hasCode) {
    // Add the coupon URL to the request queue
    await requestQueue.addRequest(
      {
        url: couponUrl,
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
