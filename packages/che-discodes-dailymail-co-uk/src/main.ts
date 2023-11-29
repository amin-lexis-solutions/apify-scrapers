// For more information, see https://crawlee.dev/
import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';

import { Label, router } from './routes';

const startUrl = 'https://discountcode.dailymail.co.uk/sitemap.xml';

// Define the main run function as an async function
async function main() {
  await Actor.init();

  // use proxy configuration if provided in input
  const input: any = await Actor.getInput();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  const crawler = new CheerioCrawler({
    proxyConfiguration, // Use this if you need proxy configuration, else comment it out or remove
    requestHandler: router,
    // Additional options can go here, e.g., maxConcurrency, requestTimeouts, etc.
  });

  // Adding the initial request with a handlerLabel in userData
  await crawler.addRequests([
    {
      url: startUrl,
      label: Label.sitemap,
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
