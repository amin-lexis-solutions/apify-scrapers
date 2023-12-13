import cheerio from 'cheerio';
import { RequestProvider } from 'crawlee';

import { CUSTOM_HEADERS, Label } from './constants';
import { DataValidator } from './data-validator';
import { formatDateTime, processAndStoreData } from './utils';

export function extractDomainFromImageUrl(url: string): string {
  // Regular expression to extract the file name without extension
  const regex = /\/([^/]+)\.\w+$/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Replace dashes with dots in the top-level domain part
    return matches[1].replace(/-(?=[^.]*$)/, '.');
  }

  return '';
}

export function buildCouponUrl(onclickAttr: string, sourceUrl: string): string {
  // Extract the URL and parameters from the onclick attribute
  const regex = /openPopup\('.*?','(.*?)'\)/;
  const matches = onclickAttr.match(regex);

  if (matches && matches[1]) {
    // Decode the extracted URL
    let extractedUrl = decodeURIComponent(matches[1]);
    // Replace &amp; with &
    extractedUrl = extractedUrl.replace(/&amp;/g, '&');
    // Extract the query parameters
    const queryParamsMatch = extractedUrl.match(/\?(.*)$/);

    if (queryParamsMatch && queryParamsMatch[1]) {
      // Append the query parameters to the sourceUrl
      return `${sourceUrl}?${queryParamsMatch[1]}`;
    }
  }

  return sourceUrl; // Return the sourceUrl if no parameters are found
}

export function extractIdFromUrl(url: string): string | null {
  // Regular expression to find the _id parameter
  const regex = /[?&]_id=([^&]+)/;
  const matches = url.match(regex);

  if (matches && matches[1]) {
    return matches[1];
  } else {
    return null; // Return null if _id is not found
  }
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

  const elementClass = $coupon('*').first().attr('class');
  if (!elementClass) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class is missing');
  }

  let hasCode = false;
  if (elementClass.includes('nocode') || elementClass.includes('code')) {
    hasCode = elementClass.includes('code') && !elementClass.includes('nocode');
  } else {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Element class doesn\'t contain "nocode" or "code"');
  }

  const clickUrlElement = $coupon('div.dF');
  if (clickUrlElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Click URL element is missing');
  }

  const onclick = clickUrlElement.attr('onclick');
  if (!onclick) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Click URL onclick attr is missing');
  }

  // Build the coupon URL
  const couponUrl = buildCouponUrl(onclick, sourceUrl);

  // Extract the coupon ID from the URL
  const idInSite = extractIdFromUrl(couponUrl);

  // Extract the voucher title
  const titleElement = $coupon('p').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  let expiryDateTxt: string | null = null;
  const descElement = $coupon('div.c-details > div.hidden-details');
  let description = '';
  if (descElement.length > 0) {
    descElement.find('.hk').each(function (this: cheerio.Cheerio) {
      let key = cheerio(this).children().first().text().trim();
      const value = cheerio(this).children().last().text().trim();

      // Remove trailing colon from the key, if present
      key = key.replace(/:$/, '');

      description += `${key}: ${value}\n`;
    });

    // Use descElement to find the .hk element with 'Validity:'
    const validityItem = descElement
      .find('.hk')
      .filter(function (this: cheerio.Element) {
        return cheerio(this).children().first().text().trim() === 'Validity:';
      })
      .first();

    // Extract the date if the element is found
    if (validityItem.length > 0) {
      expiryDateTxt = validityItem.children().last().text().trim();
    }
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
  if (expiryDateTxt) {
    validator.addValue('expiryDateAt', formatDateTime(expiryDateTxt));
  }
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
