import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { CUSTOM_HEADERS, Label } from './constants';
import { processCouponItem, extractDomainFromUrl } from './routes-helpers';

export const router = createCheerioRouter();

router.addHandler(Label.sitemap, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.sitemap) return;

  const sitemapLinks = $('dd.merchant-list-item__merchant > a');
  if (sitemapLinks.length === 0) {
    console.log('Sitemap HTML:', $.html());
    throw new Error('Sitemap links are missing');
  }
  // Base URL from the request
  const baseUrl = new URL(request.url);

  // Map each link to a full URL
  const sitemapUrls = sitemapLinks
    .map((i, el) => {
      const sitemapUrl = $(el).attr('href');

      // Skip if the href attribute is missing
      if (typeof sitemapUrl === 'undefined') {
        throw new Error('Sitemap link is missing the href attribute');
      }

      return sitemapUrl;
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
        crawler.requestQueue,
        merchantName,
        domain,
        element,
        request.url,
        i + 1
      );
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});
