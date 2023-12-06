import { PuppeteerCrawlingContext, Router } from 'crawlee';

import { DataValidator } from './data-validator';
import { formatDateTime, getDomainName, processAndStoreData } from './utils';

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'getCode' = 'GetCodePage',
}

declare global {
  interface Window {
    __NEXT_DATA__?: any; // You can replace `any` with a more specific type if you have one
  }
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
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.sitemap, async ({ page, request, enqueueLinks }) => {
  if (request.userData.label !== Label.sitemap) return;

  // Use Puppeteer's page.evaluate to interact with the DOM and extract sitemap URLs
  const sitemapUrls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('urlset url loc')).map(
      (el) => el.textContent?.trim() || ''
    );
  });
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
  const filteredUrls = sitemapUrls.filter((url) => {
    // Ensure the URL is trimmed before testing
    const trimmedUrl = url.trim();
    const notHomepage = trimmedUrl != 'https://discountcode.dailymail.co.uk/';
    const notBanned = !bannedPatterns.some((pattern) =>
      pattern.test(trimmedUrl)
    );
    return notHomepage && notBanned;
  });
  console.log(
    `Found ${filteredUrls.length} URLs after filtering banned patterns`
  );

  let x = sitemapUrls.length; // Use the full length for production
  if (request.userData.testLimit) {
    // Take only the first X URLs for testing
    x = Math.min(request.userData.testLimit, sitemapUrls.length);
  }

  const testUrls = sitemapUrls.slice(0, x);
  if (x < sitemapUrls.length) {
    console.log(`Using ${testUrls.length} URLs for testing`);
  }

  // Enqueue the new URLs with the appropriate label
  await enqueueLinks({
    urls: testUrls,
    userData: {
      label: Label.listing,
    },
  });
});

router.addHandler(Label.listing, async ({ page, request, enqueueLinks }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`\nProcessing URL: ${request.url}`);

    await page.waitForFunction(() => {
      return !!window.__NEXT_DATA__;
    });

    const htmlContent = await page.content();
    const jsonPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
    const match = htmlContent.match(jsonPattern);

    let jsonData;
    let retailerId;
    if (match && match[1]) {
      jsonData = JSON.parse(match[1]);
      retailerId = jsonData.query.clientId;
      jsonData = jsonData.props.pageProps;
    } else {
      throw new Error(
        'No matching script tag found or no JSON content present'
      );
    }

    if (!jsonData.retailer) {
      throw new Error('Retailer data is missing in the parsed JSON');
    }

    console.log(
      `\n\nFound ${jsonData.vouchers.length} active vouchers and ${jsonData.expiredVouchers.length} expired vouchers\n    at: ${request.url}\n`
    );

    const merchantName = jsonData.retailer.name;
    const merchantUrl = jsonData.retailer.merchant_url;
    const domain = getDomainName(merchantUrl);

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
      const validator = new DataValidator();

      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', voucher.title);
      validator.addValue('idInSite', voucher.id_voucher);

      validator.addValue('domain', domain);
      validator.addValue('description', voucher.description);
      validator.addValue('termsAndConditions', voucher.terms_and_conditions);
      validator.addValue('expiryDateAt', formatDateTime(voucher.end_time));
      validator.addValue('startDateAt', formatDateTime(voucher.start_time));
      validator.addValue('isExclusive', voucher.exclusive_voucher);
      validator.addValue('isExpired', voucher.is_expired);
      validator.addValue('isShown', true);

      const codeType = checkVoucherCode(voucher.code);

      if (!codeType.isEmpty) {
        if (!codeType.startsWithDots) {
          validator.addValue('code', codeType.code);
          await processAndStoreData(validator);
        } else {
          const idPool = voucher.id_pool;
          const codeDetailsUrl = `https://discountcode.dailymail.co.uk/api/voucher/country/uk/client/${retailerId}/id/${idPool}`;
          const validatorData = validator.getData();

          await enqueueLinks({
            urls: [codeDetailsUrl],
            userData: { label: Label.getCode, validatorData },
            forefront: true,
          });
        }
      } else {
        await processAndStoreData(validator);
      }
    }
  } catch (error) {
    console.error(`An error occurred while processing ${request.url}:`, error);
  }
});

router.addHandler(Label.getCode, async ({ page, request }) => {
  if (request.userData.label !== Label.getCode) return;

  try {
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const htmlContent = await page.content();
    const jsonPattern = /<pre[^>]*>(.*?)<\/pre>/s;
    const match = htmlContent.match(jsonPattern);

    if (match && match[1]) {
      const jsonCodeData = JSON.parse(match[1]);
      const code = jsonCodeData.code;
      console.log(`Found code: ${code}\n    at: ${request.url}`);
      validator.addValue('code', code);
      await processAndStoreData(validator);
    } else {
      throw new Error('No matching pre tag found or no JSON content present');
    }
  } catch (error) {
    console.error(`An error occurred while processing ${request.url}:`, error);
  }
});

export { router };
