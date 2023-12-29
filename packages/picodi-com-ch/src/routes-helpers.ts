import cheerio from 'cheerio';
import { RequestProvider } from 'crawlee';
import * as he from 'he';
import { CUSTOM_HEADERS, Label } from './constants';
import { DataValidator } from './data-validator';
import { processAndStoreData } from './utils';

export async function processCouponItem(
  requestQueue: RequestProvider,
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;

  if (!isExpired) {
    const elementClass = $coupon('*').first().attr('class');
    if (!elementClass) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Element class is missing');
    }

    if (
      elementClass.includes('type-code') ||
      elementClass.includes('type-promo')
    ) {
      hasCode =
        elementClass.includes('type-code') &&
        !elementClass.includes('type-promo');
    } else {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error(
        'Element class doesn\'t contain "type-code" or "type-promo"'
      );
    }

    const idInSite = $coupon('*').first().attr('data-offer-id');
    if (!idInSite) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Element data-offer-id attr is missing');
    }

    // Extract the voucher title
    const titleElement = $coupon('div.of__content > h3').first();
    if (titleElement.length === 0) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Voucher title is missing');
    }
    const voucherTitle = he.decode(titleElement.text().trim());

    // Extract the description
    let description = '';
    const descElement = $coupon('div.of__content').first();
    if (descElement.length > 0) {
      description = he
        .decode(descElement.text())
        .replace(voucherTitle, '') // remove the title from the descriptions
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
    validator.addValue('title', voucherTitle);
    validator.addValue('idInSite', idInSite);
    validator.addValue('description', description);
    validator.addValue('isExpired', isExpired);
    validator.addValue('isShown', true);

    if (hasCode) {
      const couponUrl = `https://s.picodi.com/ch/api/offers/${idInSite}/v2`;
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
}
