// For more information, see https://crawlee.dev/
import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';

import { Label, getSitemapUrls, router } from './routes';

const startUrl = 'https://cdn-s3.sparwelt.de/sitemap/sitemap-provider.xml';

// Define the main run function as an async function
async function main() {
  await Actor.init();

  // use proxy configuration if provided in input
  const input: any = await Actor.getInput();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  let effectiveTestLimit = 0;
  if (typeof input?.testLimit === 'number' && input?.testLimit > 0) {
    effectiveTestLimit = input?.testLimit;
  }

  const crawler = new CheerioCrawler({
    proxyConfiguration, // Use this if you need proxy configuration, else comment it out or remove
    requestHandler: router,
    // Additional options can go here, e.g., maxConcurrency, requestTimeouts, etc.
  });

  // Adding the initial request with a handlerLabel in userData
  const sitemapUrls = await getSitemapUrls(startUrl);

  let x = sitemapUrls.length; // Use the full length for production
  if (effectiveTestLimit) {
    // Take only the first X URLs for testing
    x = Math.min(effectiveTestLimit, sitemapUrls.length);
  }

  const testUrls = sitemapUrls.slice(0, x);
  if (x < sitemapUrls.length) {
    console.log(`Using ${testUrls.length} URLs for testing`);
  }

  const requests = testUrls.map((url) => ({
    url,
    label: Label.listing,
  }));

  // Add the requests to the crawler
  await crawler.addRequests(requests);

  // Run the crawler with the startUrls array
  await crawler.run();

  await Actor.exit();
}

// Call the main function and properly handle any errors
main().catch((error) => {
  console.error('Error occurred:', error);
  process.exit(1);
});
