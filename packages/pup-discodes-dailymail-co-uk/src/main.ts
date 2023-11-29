// For more information, see https://crawlee.dev/
import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';
import { router, Label } from './routes';

const startUrl = 'https://discountcode.dailymail.co.uk/sitemap.xml';

// Define the main run function as an async function
async function main() {
  await Actor.init();

  // use proxy configuration if provided in input
  const input: any = await Actor.getInput();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  const crawler = new PuppeteerCrawler({
    proxyConfiguration, // Use this if you need proxy configuration, else comment it out or remove
    // Set to `true` if running locally for visual debugging; otherwise, it's best to keep headless for performance.
    headless: true,
    // Enable if you want to reuse sessions to minimize login and other overhead.
    useSessionPool: true,
    // Adjust based on how often requests fail and need to be retried.
    maxRequestRetries: 3, // A more reasonable default
    // Adjust based on the website's response time.
    navigationTimeoutSecs: 60,
    // Add hooks if you need to block certain requests.
    // preNavigationHooks: [...],
    launchContext: {
      launchOptions: {
        // Add arguments if needed to solve particular issues like running in a Docker container.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // ... other Puppeteer arguments if needed
        ],
      },
    },
    requestHandler: router, // assuming 'router' is properly defined elsewhere
    // ... other configurations ...
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
