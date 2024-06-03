import { RequestQueue } from 'apify'; // Import types from Apify SDK
import { DataValidator } from 'shared/data-validator';
import { logError } from 'shared/helpers';
import { sleep } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'getCode' = 'GetCodePage',
}

type Voucher = {
  isExpired: boolean;
  isExclusive: boolean;
  idInSite: string | undefined;
  title: string;
  description: string;
};

export async function sitemapHandler(requestQueue: RequestQueue, context) {
  // context includes request, body, etc.
  const { request, page, log } = context;

  if (request.userData.label !== Label.sitemap) return;

  const sitemapUrls = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll('section > div.row > div a')
    );
    return links.map((link) => (link as HTMLAnchorElement).href);
  });

  log.info(`Found ${sitemapUrls.length} URLs in the sitemap`);

  let limit = sitemapUrls.length; // Use the full length for production
  if (request.userData.testLimit) {
    // Take only the first X URLs for testing
    limit = Math.min(request.userData.testLimit, sitemapUrls.length);
  }

  const testUrls = sitemapUrls.slice(0, limit);

  if (limit < sitemapUrls.length) {
    log.info(`Using ${testUrls.length} URLs for testing`);
  }

  // Manually add each URL to the request queue
  for (const url of testUrls) {
    await requestQueue.addRequest({
      url: url,
      userData: {
        label: Label.listing,
      },
    });
  }
}

export async function listingHandler(requestQueue: RequestQueue, context) {
  const { request, page, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Processing URL: ${request.url}`);

    // Extract merchant name and domain using Puppeteer
    const merchantName = await page.evaluate(() => {
      const storeLogoElement: HTMLImageElement = document.querySelector(
        'main.main-shop > div.header-shop-ctnr > div.container > div.header-shop-logo-ctnr > img'
      ) as HTMLImageElement;
      return storeLogoElement ? storeLogoElement.alt.trim() : null;
    });

    if (!merchantName) {
      logError('Merchant name not found');
      return;
    }

    const domain = new URL(request.url).pathname.replace(/^\//, '');

    if (!domain) {
      log.warning('Domain information not found');
    }

    // Extract coupons and offers using Puppeteer
    const vouchers: Voucher[] = await page.evaluate(() => {
      const voucherElements = Array.from(
        document.querySelectorAll(
          'main.main-shop > div.container > div.row > div > div.row > div.container > div.card-offer-shop'
        )
      );

      return voucherElements.map((el) => {
        const elementClass = el.className || '';
        const isExpired = elementClass.includes('offer-exp');
        const isExclusive = !!el.querySelector(
          'div.card-body span.exclu-offer'
        );

        const idInSite = el.id.trim().replace('c-', '');

        if (!idInSite) {
          logError(`1idInSite not found`);
          return;
        }

        const title = el
          ?.querySelector('div.card-body h2 > span')
          ?.textContent?.trim();

        if (!title) {
          logError(`title not found`);
          return;
        }

        const descrRaw =
          el.querySelector('div.card-body div.shop-offer-desc > div.details')
            ?.innerHTML || '';
        const description = descrRaw
          .replace(/<span class="read-less">.*?<\/span>/s, '')
          .trim();

        return { isExpired, isExclusive, idInSite, title, description };
      });
    });

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            coupons: vouchers,
          },
        },
        context
      );
    } catch (error: any) {
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    // Process each voucher
    for (const voucher of vouchers) {
      await sleep(1000); // Sleep for x seconds between requests to avoid rate limitings

      // Create a new DataValidator instance
      const validator = new DataValidator();

      // Add required values to the validator
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', voucher.title);
      validator.addValue('idInSite', voucher.idInSite);

      // Add optional values to the validator
      validator.addValue('domain', domain);
      validator.addValue('isExclusive', voucher.isExclusive);
      validator.addValue('isExpired', voucher.isExpired);
      validator.addValue('isShown', true);

      // Get the code
      const cleanRequestUrl = request.url.split('?')[0];
      const codeDetailsUrl = `${cleanRequestUrl}?c=${voucher.idInSite}&so=s#c-${voucher.idInSite}`;
      const validatorData = validator.getData();

      // Add the request to the request queue
      await requestQueue.addRequest(
        {
          url: codeDetailsUrl,
          userData: {
            label: Label.getCode,
            validatorData: validatorData,
          },
        },
        { forefront: true }
      );
    }
  } catch (error) {
    logError(`An error occurred while processing the URL ${request.url}:`);
    return;
  }
}

export async function codeHandler(requestQueue: RequestQueue, context) {
  // context includes request, body, etc.
  const { request, page, log } = context;

  log.info(`\nProcessing URL: ${request.url}`);

  if (request.userData.label !== Label.getCode) return;

  // wait for the page to fully load
  await page.waitForSelector('#modalDiscount');

  const showOfferElement = await page.$('.show-the-code button');
  if (showOfferElement) {
    await showOfferElement.click();
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#modalDiscount');
  }

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Check for the presence of the modal body

    // Extract the code if present
    let code = await page.evaluate(() => {
      const codeInput: HTMLInputElement = document.querySelector(
        'input#code'
      ) as HTMLInputElement;
      if (codeInput) {
        return codeInput.value.trim();
      }
      return null; // Return null if code is not present
    });

    if (code) {
      if (/^[*]+$/.test(code)) {
        log.info('Code is only asterisks, ignoring it.');
        code = null;
      }
      if (code) validator.addValue('code', code);
      log.info(`Found code: ${code}\n    at: ${request.url}`);
    } else {
      log.warning(`No visible code found at: ${request.url}`);
    }

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } catch (error) {
    // Handle any errors that occurred during the handler execution
    log.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
}
