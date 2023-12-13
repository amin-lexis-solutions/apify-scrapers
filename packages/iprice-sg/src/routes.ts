import { createCheerioRouter } from 'crawlee';

import { CUSTOM_HEADERS, Label } from './constants';
import { DataValidator } from './data-validator';
import { extractDomainFromImageUrl, processCouponItem } from './routes-helpers';
import { processAndStoreData, sleep } from './utils';

export const router = createCheerioRouter();

router.addHandler(Label.sitemap, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler } = context;

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

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  // Manually add each URL to the request queue
  for (const url of testUrls) {
    await crawler.requestQueue.addRequest({
      url: url,
      userData: {
        label: Label.listing,
      },
      headers: CUSTOM_HEADERS,
    });
  }
});

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

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
          crawler.requestQueue,
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
          crawler.requestQueue,
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
});

router.addHandler(Label.getCode, async (context) => {
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
});
