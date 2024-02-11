import { createCheerioRouter } from 'crawlee';
import { CUSTOM_HEADERS, Label, OfferItem } from './constants';
import { processCouponItem } from './routes-helpers';
import { getDomainName, processAndStoreData, sleep } from './utils';
import { DataValidator } from './data-validator';

export const router = createCheerioRouter();

router.addHandler(Label.sitemap, async (context) => {
  // context includes request, body, etc.
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.sitemap) return;

  const sitemapLinks = $('urlset url loc');
  if (sitemapLinks.length === 0) {
    console.log('Sitemap HTML:', $.html());
    throw new Error('Sitemap links are missing');
  }
  let sitemapUrls = sitemapLinks.map((i, el) => $(el).text().trim()).get();

  console.log(`Found ${sitemapUrls.length} URLs in the sitemap`);

  // Define a list of banned URL patterns (regular expressions)
  const bannedPatterns: RegExp[] = [
    /\/kategorie\//,
    /\/alle-anbieter$/,
    /\/beste-gutscheine$/,
    /\/exklusive-gutscheine$/,
    /\/kategorien$/,
    /\/neue-gutscheine$/,
    /\/specials$/,
  ];

  if (bannedPatterns.length > 0) {
    // Filter out URLs that match any of the banned patterns
    const oldLength = sitemapUrls.length;
    sitemapUrls = sitemapUrls.filter((url) => {
      const notBanned = !bannedPatterns.some((pattern) => pattern.test(url));
      return notBanned;
    });

    if (sitemapUrls.length < oldLength) {
      console.log(
        `Remained ${sitemapUrls.length} URLs after filtering banned patterns`
      );
    }
  }

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

    let jsonData: any = null; // Consider defining a more specific type based on the expected structure of your JSON data

    $('script').each((index, element) => {
      const scriptElement = $(element);
      const scriptContent: string | null = scriptElement.html();

      if (scriptContent && scriptContent.startsWith('window.nuxt =')) {
        // Extract the JSON string
        const jsonString = scriptContent.replace('window.nuxt =', '').trim();
        try {
          // Parse the JSON string
          jsonData = JSON.parse(jsonString);
        } catch (error) {
          console.log('Error parsing JSON data:', error);
        }
      }
    });

    if (!jsonData) {
      console.log(
        `No matching script tag found or JSON parsing failed: ${request.url}`
      );
    } else if (jsonData.data.offers && jsonData.data.offers.length > 0) {
      const offers = jsonData.data.offers;
      console.log(`Found ${offers.length} offers`);
      // console.log(offers[0]);
      const merchantName = offers[0].node.partnerShoppingShop.title;
      const domain = getDomainName(
        offers[0].node.partnerShoppingShop.shoppingShop.domainUrl
      );

      if (!merchantName) {
        console.log(`Merchant name not found: ${request.url}`);
      } else {
        for (let i = 0; i < offers.length; i++) {
          const item = offers[i] as OfferItem;
          await processCouponItem(
            crawler.requestQueue,
            merchantName,
            domain,
            item,
            request.url
          );
        }
      }
    } else {
      console.log(`No offers found: ${request.url}`);
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
  const { request, body } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Safely parse the JSON string
    let jsonCodeData;
    try {
      jsonCodeData = JSON.parse(htmlContent);
    } catch (error) {
      throw new Error('Failed to parse JSON from HTML content');
    }

    // Validate the necessary data is present
    if (!jsonCodeData || !jsonCodeData.voucher_code) {
      throw new Error('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.voucher_code;
    console.log(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
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
