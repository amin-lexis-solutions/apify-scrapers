import { RequestQueue } from 'apify'; // Import types from Apify SDK
import cheerio from 'cheerio';

import { DataValidator } from './data-validator';
import { formatDateTime, processAndStoreData, sleep } from './utils';

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'getCode' = 'GetCodePage',
}

const customHeaders = {
  'User-Agent':
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/117.0',
};

function extractDomainFromImageUrl(url: string): string {
  // Regular expression to extract the file name without extension
  const regex = /\/([^\/]+)\.\w+$/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Replace dashes with dots in the top-level domain part
    return matches[1].replace(/-(?=[^.]*$)/, '.');
  }

  return '';
}

function buildCouponUrl(onclickAttr: string, sourceUrl: string): string {
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

function extractIdFromUrl(url: string): string | null {
  // Regular expression to find the _id parameter
  const regex = /[?&]_id=([^&]+)/;
  const matches = url.match(regex);

  if (matches && matches[1]) {
    return matches[1];
  } else {
    return null; // Return null if _id is not found
  }
}

async function processCouponItem(
  requestQueue: RequestQueue,
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
        headers: customHeaders,
      },
      { forefront: true }
    );
  } else {
    await processAndStoreData(validator);
  }
}

export async function sitemapHandler(requestQueue: RequestQueue, context) {
  // context includes request, body, etc.
  const { request, $ } = context;

  if (request.userData.label !== Label.sitemap) return;

  const sitemapLinks = $('div[data-uat="coupon-store-item"] > p > a');
  if (sitemapLinks.length === 0) {
    console.log('Sitemap HTML:', $.html());
    throw new Error('Sitemap links are missing');
  }
  const sitemapUrls = sitemapLinks.map((i, el) => $(el).attr('href')).get();

  console.log(`Found ${sitemapUrls.length} URLs in the sitemap`);

  let limit = sitemapUrls.length; // Use the full length for production
  if (request.userData.testLimit) {
    // Take only the first X URLs for testing
    limit = Math.min(request.userData.testLimit, sitemapUrls.length);
  }

  const testUrls = sitemapUrls.slice(0, limit);
  if (limit < sitemapUrls.length) {
    console.log(`Using ${testUrls.length} URLs for testing`);
  }

  // Manually add each URL to the request queue
  for (const url of testUrls) {
    await requestQueue.addRequest({
      url: url,
      userData: {
        label: Label.listing,
      },
      headers: customHeaders,
    });
  }
}

export async function listingHandler(requestQueue: RequestQueue, context) {
  // context includes request, body, etc.
  const { request, $ } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Check if valid page
    if (!$('div#coupon-header img.ek').length) {
      console.log(`Not Merchant URL: ${request.url}`);
    } else {
      const merchantLogoImg = $('div#coupon-header img.ek');
      let merchantName = '';
      let domain = '';
      if (merchantLogoImg.length > 0) {
        merchantName = merchantLogoImg.attr('alt')?.trim() || '';
        domain = extractDomainFromImageUrl(
          merchantLogoImg.attr('srcset')?.trim() || ''
        );
      }

      if (!merchantName) {
        throw new Error('Unable to find merchant name');
      }
      // console.log(`Merchant Name: ${merchantName}, Domain: ${domain}`);

      // Extract valid coupons
      const validCoupons = $(
        'section#store-active-coupon > div:not([class^=nocode])[class*=code], section#store-active-coupon > div[class*=nocode]'
      );
      for (let i = 0; i < validCoupons.length; i++) {
        const element = validCoupons[i];
        await processCouponItem(
          requestQueue,
          merchantName,
          domain,
          false,
          element,
          request.url
        );
      }

      // Extract expired coupons
      const expiredCoupons = $(
        'section.wb.y > div:not([class^=nocode])[class*=code], section.wb.y > div[class*=nocode]'
      );
      for (let i = 0; i < expiredCoupons.length; i++) {
        const element = expiredCoupons[i];
        await processCouponItem(
          requestQueue,
          merchantName,
          domain,
          true,
          element,
          request.url
        );
      }
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
}

export async function codeHandler(requestQueue: RequestQueue, context) {
  // context includes request, body, etc.
  const { request, $ } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Extract the coupon code
    const codeSpan = $('span#code');
    if (codeSpan.length === 0) {
      console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code span is missing');
    }

    const code = codeSpan.text().trim();

    // Check if the code is found
    if (!code) {
      console.log('Coupon HTML:', $.html());
      throw new Error('Coupon code not found in the HTML content');
    }

    console.log(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await processAndStoreData(validator);
  } catch (error) {
    // Handle any errors that occurred during the handler execution
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
}
