// For more information, see https://crawlee.dev/
import { Actor } from 'apify';
import { PuppeteerCrawler } from 'crawlee';
import { Label, sitemapHandler, listingHandler, codeHandler } from './routes';

const FACEBOOK_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.182 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/308.  0.0.  0.  0;]';

// Define the main run function as an async function
async function main() {
  await Actor.init();

  // Initialize the request queue
  const requestQueue = await Actor.openRequestQueue();

  // use proxy configuration if provided in input
  const input: any = await Actor.getInput();
  const startUrls = input?.startUrls || [
    {
      url: 'https://www.i-reductions.ch/boutique-vente-en-ligne-suisse',
      Label: Label.sitemap,
      metadata: { locale: 'fr_CH', targetPageId: '', localeId: '' },
    },
  ];
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  let effectiveTestLimit = 0;
  if (typeof input?.testLimit === 'number' && input?.testLimit > 0) {
    effectiveTestLimit = input?.testLimit;
  }

  const crawler = new PuppeteerCrawler({
    proxyConfiguration: proxyConfiguration as any,
    launchContext: {
      userAgent: FACEBOOK_BROWSER_USER_AGENT,
      launchOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    },
    preNavigationHooks: [
      (crawlingContext) => {
        if (crawlingContext.request.userData.label !== Label.getCode) return;

        // set cookie to the request
        const url = crawlingContext.request.url;
        // find cookie name c- in cookies and get c- value
        const cookies =
          crawlingContext.session
            ?.getCookies(url)
            .filter((cookie) => cookie.name.includes('c-')) || [];

        // create new cookie name jc- with value from cookie name c- time 120 write in cookieraw
        cookies.forEach((cookie) => {
          crawlingContext.session?.setCookie(
            `jc-${cookie.name.split('-')[1]}=${
              cookie.name.split('-')[1]
            }; Max-Age=120; Path=/; Domain=.i-reductions.ch; Secure; SameSite=None`,
            url
          );
        });
      },
    ],
    requestHandler: async (context) => {
      const { request } = context;
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

  await crawler.addRequests(
    startUrls.map((item) => ({
      url: item.url,
      userData: {
        label: item.Label || Label.listing,
        metadata: item.metadata,
        testLimit: effectiveTestLimit,
      },
    }))
  );
  // Run the crawler with the startUrls array
  await crawler.run();

  await Actor.exit();
}

// Call the main function and properly handle any errors
main().catch((error) => {
  console.error('Error occurred:', error);
  process.exit(1);
});
