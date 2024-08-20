import { RequestQueue } from 'apify'; // Import types from Apify SDK
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { sleep } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'getCode' = 'GetCodePage',
}

type Item = {
  isExpired: boolean;
  isExclusive: boolean;
  idInSite: string | undefined;
  title: string;
  description: string;
  merchantName: string;
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
        ...request.userData.metadata,
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

    // Extract coupons and offers using Puppeteer
    const items: Item[] = await page.evaluate(() => {
      const itemElements = Array.from(
        document.querySelectorAll(
          'main.main-shop > div.container > div.row > div > div.row > div.container > div.card-offer-shop'
        )
      );

      return itemElements.map((el) => {
        const elementClass = el.className || '';
        const isExpired = elementClass.includes('offer-exp');
        const isExclusive = !!el.querySelector(
          'div.card-body span.exclu-offer'
        );

        const merchantName = el
          .querySelector('.shop-offer-logo-ctnr img')
          ?.getAttribute('alt');

        const idInSite = el.id.trim().replace('c-', '');

        if (!idInSite) {
          logger.error(`1idInSite not found`);
          return;
        }

        const title = el
          ?.querySelector('div.card-body h2 > span')
          ?.textContent?.trim();

        if (!title) {
          logger.error(`title not found`);
          return;
        }

        if (!merchantName) {
          logger.error('Merchant name not found item');
          return;
        }

        const descrRaw =
          el.querySelector('div.card-body div.shop-offer-desc > div.details')
            ?.innerHTML || '';
        const description = descrRaw
          .replace(/<span class="read-less">.*?<\/span>/s, '')
          .trim();

        return {
          isExpired,
          isExclusive,
          idInSite,
          title,
          description,
          merchantName,
        };
      });
    });

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            items,
          },
        },
        context
      );
    } catch (error: any) {
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    const domain = new URL(request.url).pathname.replace(/^\//, '');

    if (!domain) {
      log.warning('Domain information not found');
    }
    // Process each voucher
    for (const item of items) {
      await sleep(1000); // Sleep for x seconds between requests to avoid rate limitings

      // Create a new DataValidator instance
      const validator = new DataValidator();

      // Add required values to the validator
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', item.merchantName);
      validator.addValue('title', item.title);
      validator.addValue('idInSite', item.idInSite);

      // Add optional values to the validator
      validator.addValue('domain', domain);
      validator.addValue('isExclusive', item.isExclusive);
      validator.addValue('isExpired', item.isExpired);
      validator.addValue('isShown', true);

      // Get the code
      const cleanRequestUrl = request.url.split('?')[0];
      const codeDetailsUrl = `${cleanRequestUrl}?c=${item.idInSite}&so=s#c-${item.idInSite}`;
      const validatorData = validator.getData();

      // Add the request to the request queue
      await requestQueue.addRequest(
        {
          url: codeDetailsUrl,
          userData: {
            ...request.userData.metadata,
            label: Label.getCode,
            validatorData: validatorData,
          },
        },
        { forefront: true }
      );
    }
  } catch (error) {
    logger.error(`An error occurred while processing the URL ${request.url}:`);
    return;
  }
}

export async function codeHandler(requestQueue: RequestQueue, context) {
  // context includes request, body, etc.
  const { request, page, log } = context;

  log.info(`\nProcessing URL: ${request.url}`);

  if (request.userData.label !== Label.getCode) return;

  async function waitForModal(selector: string, timeout: number) {
    try {
      await page.waitForSelector(selector, { timeout, visible: true });
    } catch (e) {
      log.warning(`${selector} HTML element timeout - ${e}`);
    }
  }

  async function handleShowOfferElement(showOfferElement) {
    try {
      await showOfferElement.click();
      await page.reload({ waitUntil: 'load' });
      await waitForModal('#modalDiscount', 50000);
    } catch (e) {
      log.warning(`Error handling show offer element - ${e}`);
    }
  }

  async function validateCode() {
    try {
      const validatorData = request.userData.validatorData;
      const validator = new DataValidator();
      validator.loadData(validatorData);

      const code = await extractCode();
      if (code) {
        validator.addValue('code', code);
        log.info(`Found code: ${code}\n    at: ${request.url}`);
      } else {
        log.warning(`No visible code found at: ${request.url}`);
      }

      await postProcess({ SaveDataHandler: { validator } }, context);
    } catch (error) {
      log.warning(`Error during code processing at ${request.url}:`, error);
    }
  }

  async function extractCode(): Promise<string | null> {
    try {
      const code = await page.evaluate(() => {
        const codeInput: HTMLInputElement = document.querySelector(
          'input#code'
        ) as HTMLInputElement;
        return codeInput ? codeInput.value.trim() : null;
      });

      if (code && /^[*]+$/.test(code)) {
        log.info('Code is only asterisks, ignoring it.');
        return null;
      }

      return code;
    } catch (e) {
      log.warning('Error extracting code:', e);
      return null;
    }
  }

  try {
    await waitForModal('#modalDiscount', 50000);
    const showOfferElement = await page.$('.show-the-code button');

    if (showOfferElement) {
      await handleShowOfferElement(showOfferElement);
    }

    await validateCode();
  } catch (error) {
    log.warning(
      `An error occurred while processing GetCode handler ${request.url}:`,
      error
    );
  }
}
