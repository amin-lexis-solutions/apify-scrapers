import { createCheerioRouter } from 'crawlee';
import { CUSTOM_HEADERS, Label } from './constants';
import { processCouponItem } from './routes-helpers';
import { getDomainName } from './utils';

export const router = createCheerioRouter();

router.addHandler(Label.sitemap, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.sitemap) return;

  const sitemapLinks = $('div[id^=store-] span > a');
  if (sitemapLinks.length === 0) {
    console.log('Sitemap HTML:', $.html());
    throw new Error('Sitemap links are missing');
  }
  // Base URL from the request
  const baseUrl = new URL(request.url);

  // Map each link to a full URL
  const sitemapUrls = sitemapLinks
    .map((i, el) => {
      const relativePath = $(el).attr('href');

      // Skip if the href attribute is missing
      if (typeof relativePath === 'undefined') {
        throw new Error('Sitemap link is missing the href attribute');
      }

      return new URL(relativePath, baseUrl).href;
    })
    .get();

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

    // Extract JSON data from the script tag
    const scriptContent = $('#schema-data-store').html();
    if (!scriptContent) {
      console.log('Not a valid merchant page - schema data missing');
    } else {
      // Parse the JSON data
      const jsonData = JSON.parse(scriptContent);
      const merchantName = jsonData.name;
      const domain = getDomainName(jsonData.url);

      // Check if valid page
      if (!merchantName) {
        console.log(`Not Merchant URL: ${request.url}`);
      } else {
        // console.log(`Merchant Name: ${merchantName}`);
        // console.log('Domain:', domain);
        // Extract valid coupons
        const validCoupons = $('ul.sc-a8fe2b69-0 > li > div');
        for (let i = 0; i < validCoupons.length; i++) {
          const element = validCoupons[i];
          await processCouponItem(
            merchantName,
            domain,
            false,
            element,
            request.url
          );
        }
        const expiredCoupons = $('div.sc-e58a3b10-5 > div');
        for (let i = 0; i < expiredCoupons.length; i++) {
          const element = expiredCoupons[i];
          await processCouponItem(
            merchantName,
            domain,
            true,
            element,
            request.url
          );
        }
      }
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});
