// For more information, see https://crawlee.dev/
import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';
import { Label, sitemapHandler, listingHandler, codeHandler } from './routes';

const startUrl = 'https://www.i-reductions.ch/boutique-vente-en-ligne-suisse';

// Define the main run function as an async function
async function main() {
  await Actor.init();

  // Initialize the request queue
  const requestQueue = await Actor.openRequestQueue();

  // use proxy configuration if provided in input
  const input: any = await Actor.getInput();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  let effectiveTestLimit = 0;
  if (typeof input?.testLimit === 'number' && input?.testLimit > 0) {
    effectiveTestLimit = input?.testLimit;
  }

  const crawler = new PuppeteerCrawler({
    proxyConfiguration,
    requestHandler: async (context) => {
      const { page, request } = context;
      switch (request.userData.label) {
        case Label.sitemap:
          await sitemapHandler(requestQueue, context);
          break;
        case Label.listing:
          await listingHandler(requestQueue, context);
          break;
        case Label.getCode:
          await codeHandler(requestQueue, context);
          break;
        default:
          throw new Error('Unknown label');
      }
    },
    // Additional options can go here
  });

  // Adding the initial request with a handlerLabel in userData
  await crawler.addRequests([
    {
      url: startUrl,
      label: Label.sitemap,
      userData: {
        testLimit: effectiveTestLimit,
      },
    },
  ]);

  // Run the crawler with the startUrls array
  await crawler.run();

  await Actor.exit();
}

// Call the main function and properly handle any errors
main().catch((error) => {
  console.error('Error occurred:', error);
  process.exit(1);
});
