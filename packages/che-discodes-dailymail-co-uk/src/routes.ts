import { EnqueueLinksOptions, createCheerioRouter } from 'crawlee';
import { parse } from 'node-html-parser';

import { DataValidator } from './data-validator';
import {
  formatDateTime,
  getDomainName,
  processAndStoreData,
  sleep,
} from './utils';

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'getCode' = 'GetCodePage',
}

function checkVoucherCode(code: string | null | undefined) {
  // Trim the code to remove any leading/trailing whitespace
  const trimmedCode = code?.trim();

  // Check if the code is null or an empty string after trimming
  if (!trimmedCode) {
    return {
      isEmpty: true,
      code: '',
      startsWithDots: false,
    };
  }

  // Check if the trimmed code starts with '...'
  if (trimmedCode.startsWith('...')) {
    return {
      isEmpty: false,
      code: trimmedCode,
      startsWithDots: true,
    };
  }

  // If the code is not empty and does not start with '...', it's a regular code
  return {
    isEmpty: false,
    code: trimmedCode,
    startsWithDots: false,
  };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.sitemap, async ({ request, body, enqueueLinks }) => {
  if (request.userData.label !== Label.sitemap) return;

  const content = typeof body === 'string' ? body : body.toString();
  const root = parse(content);
  let sitemapUrls = root
    .querySelectorAll('urlset url loc')
    .map((el) => el.text.trim());

  console.log(`Found ${sitemapUrls.length} URLs in the sitemap`);

  // Define a list of banned URL patterns (regular expressions)
  const bannedPatterns = [
    /\/about-us$/,
    /\/articles$/,
    /\/articles\//,
    /\/categories$/,
    /\/categories\//,
    /\/christmas-gifts-cheap$/,
    /\/faq$/,
    /\/mothers-day-deals$/,
    /\/seasonal-deals$/,
    /\/specials\//,
    /\/sustainable$/,
    /\/valentines-day-deals$/,
  ];

  // Filter out URLs that match any of the banned patterns
  sitemapUrls = sitemapUrls.filter((url) => {
    const notHomepage = url !== 'https://discountcode.dailymail.co.uk/';
    const notBanned = !bannedPatterns.some((pattern) => pattern.test(url));
    return notHomepage && notBanned;
  });

  console.log(
    `Found ${sitemapUrls.length} URLs after filtering banned patterns`
  );

  let limit = sitemapUrls.length; // Use the full length for production
  if (request.userData.testLimit) {
    // Take only the first X URLs for testing
    limit = Math.min(request.userData.testLimit, sitemapUrls.length);
  }

  const testUrls = sitemapUrls.slice(0, limit);
  if (limit < sitemapUrls.length) {
    console.log(`Using ${testUrls.length} URLs for testing`);
  }

  // Correct usage of enqueueLinks with 'urls' as an array
  const enqueueOptions: EnqueueLinksOptions = {
    urls: testUrls,
    label: Label.listing,
  };
  await enqueueLinks(enqueueOptions);
});

router.addHandler(Label.listing, async ({ request, body, enqueueLinks }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`\nProcessing URL: ${request.url}`);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Define a regex pattern to extract the JSON from the script tag
    const jsonPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;

    // Use the regex pattern to extract the JSON string
    const match = htmlContent.match(jsonPattern);

    let jsonData;
    let retailerId;
    if (match && match[1]) {
      try {
        // Parse the JSON string
        jsonData = JSON.parse(match[1]);
      } catch (error) {
        throw new Error('Failed to parse JSON from HTML content');
      }
      retailerId = jsonData.query.clientId;
      jsonData = jsonData.props.pageProps;
    } else {
      throw new Error(
        'No matching script tag found or no JSON content present'
      );
    }

    if (!jsonData || !jsonData.retailer) {
      throw new Error('Retailer data is missing in the parsed JSON');
    }

    console.log(
      `\n\nFound ${jsonData.vouchers.length} active vouchers and ${jsonData.expiredVouchers.length} expired vouchers\n    at: ${request.url}\n`
    );

    // Declarations outside the loop
    const merchantName = jsonData.retailer.name;
    const merchantUrl = jsonData.retailer.merchant_url;
    const domain = getDomainName(merchantUrl);

    // Combine active and expired vouchers
    const activeVouchers = jsonData.vouchers.map((voucher) => ({
      ...voucher,
      is_expired: false,
    }));
    const expiredVouchers = jsonData.expiredVouchers.map((voucher) => ({
      ...voucher,
      is_expired: true,
    }));
    const vouchers = [...activeVouchers, ...expiredVouchers];

    for (const voucher of vouchers) {
      await sleep(1000); // Sleep for 1 second between requests to avoid rate limitings

      // Create a new DataValidator instance
      const validator = new DataValidator();

      // Add required values to the validator
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', voucher.title);
      validator.addValue('idInSite', voucher.id_voucher);

      // Add optional values to the validator
      validator.addValue('domain', domain);
      validator.addValue('description', voucher.description);
      validator.addValue('termsAndConditions', voucher.terms_and_conditions);
      validator.addValue('expiryDateAt', formatDateTime(voucher.end_time));
      validator.addValue('startDateAt', formatDateTime(voucher.start_time));
      validator.addValue('isExclusive', voucher.exclusive_voucher);
      validator.addValue('isExpired', voucher.is_expired);
      validator.addValue('isShown', true);

      // code must be checked to decide the next step
      const codeType = checkVoucherCode(voucher.code);

      // Add the code to the validator
      if (!codeType.isEmpty) {
        if (!codeType.startsWithDots) {
          validator.addValue('code', codeType.code);

          // Process and store the data
          await processAndStoreData(validator);
        } else {
          const idPool = voucher.id_pool;
          const codeDetailsUrl = `https://discountcode.dailymail.co.uk/api/voucher/country/uk/client/${retailerId}/id/${idPool}`;
          const validatorData = validator.getData();

          await enqueueLinks({
            urls: [codeDetailsUrl],
            userData: {
              label: Label.getCode,
              validatorData: validatorData,
            },
            forefront: true,
          });
        }
      } else {
        // If the code is empty, process and store the data
        await processAndStoreData(validator);
      }
    }
  } catch (error) {
    // Handle any errors that occurred during processing
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});

router.addHandler(Label.getCode, async ({ request, body }) => {
  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for 3 seconds between requests to avoid rate limitings
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
    if (!jsonCodeData || !jsonCodeData.code) {
      throw new Error('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.code;
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
    // Depending on your use case, you might want to re-throw the error or handle it differently
  }
});

export { router };
