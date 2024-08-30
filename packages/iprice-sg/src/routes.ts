import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateItemId,
  ItemResult,
  formatDateTime,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function extractDomainFromImageUrl(url: string): string {
  // Regular expression to extract the file name without extension
  const regex = /\/([^/]+)\.\w+$/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Replace dashes with dots in the top-level domain part
    return matches[1].replace(/-(?=[^.]*$)/, '.');
  }

  return '';
}

function builditemUrl(sourceUrl: string, onclickAttr?: string): string {
  // Extract the URL and parameters from the onclick attribute
  const regex = /openPopup\('.*?','(.*?)'\)/;
  const matches = onclickAttr?.match(regex);

  if (matches && matches[1]) {
    // Decode the extracted URL
    let extractedUrl = decodeURIComponent(matches[1]);
    // Replace &amp; with &
    extractedUrl = extractedUrl.replace(/&amp;/g, '&');
    // Extract the query parameters
    const queryParamsMatch = extractedUrl.match(/\?(.*)$/);

    if (queryParamsMatch && queryParamsMatch[1]) {
      // Append the query parameters to the sourceUrl
      return `${sourceUrl}?${queryParamsMatch[1]}`;
    }
  }

  return sourceUrl; // Return the sourceUrl if no parameters are found
}

function extractIdFromUrl(url: string): string | null {
  // Regular expression to find the _id parameter
  const regex = /[?&]_id=([^&]+)/;
  const matches = url.match(regex);

  if (matches && matches[1]) {
    return matches[1];
  } else {
    return null; // Return null if _id is not found
  }
}

function processItem(item: any, $cheerio: cheerio.Root): ItemResult {
  const elementClass = $cheerio('*').first().attr('class');

  if (!elementClass) {
    log.warning('Element class is missing');
  }

  const hasCode = !!elementClass?.includes('code');

  const clickUrlElement = $cheerio('div.dF');

  const isExpired = !!clickUrlElement.attr('onclick')?.includes('expired');

  if (clickUrlElement.length === 0) {
    log.warning('Click URL element is missing');
  }

  const onclick = clickUrlElement.attr('onclick');

  if (!onclick) {
    log.warning('Click URL onclick attr is missing');
  }

  // Build the coupon URL
  const itemUrl = builditemUrl(item.sourceUrl, onclick);

  // Extract the coupon ID from the URL
  const idInSite = extractIdFromUrl(itemUrl);

  // Extract the description
  let expiryDateTxt: string | null = null;
  const descElement = $cheerio('div.c-details > div.hidden-details');
  let description = '';

  if (descElement.length > 0) {
    descElement.find('.hk').each(function (this: cheerio.Cheerio) {
      let key = cheerio(this).children().first().text().trim();
      const value = cheerio(this).children().last().text().trim();

      // Remove trailing colon from the key, if present
      key = key.replace(/:$/, '');

      description += `${key}: ${value}\n`;
    });

    // Use descElement to find the .hk element with 'Validity:'
    const validityItem = descElement
      .find('.hk')
      .filter(function (this: cheerio.Element) {
        return cheerio(this).children().first().text().trim() === 'Validity:';
      })
      .first();

    // Extract the date if the element is found
    if (validityItem.length > 0) {
      expiryDateTxt = validityItem.children().last().text().trim();
    }
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  expiryDateTxt
    ? validator.addValue('expiryDateAt', formatDateTime(expiryDateTxt))
    : null;

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, hasCode, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const currentItems = $(
      'section#store-active-coupon > div:not([class^=nocode])[class*=code], section#store-active-coupon > div[class*=nocode]'
    );
    // Extract expired coupons
    const expiredItems = $(
      'section.wb.y > div:not([class^=nocode])[class*=code], section.wb.y > div[class*=nocode]'
    );

    const items = [...currentItems, ...expiredItems];

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            items,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error: any) {
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    // Check if valid page
    if (!$('div#coupon-header img.ek').length) {
      logger.error(`Not Merchant URL: ${request.url}`);
      return;
    }

    const merchantLogoImg = $('div#coupon-header img.ek');

    const merchantName = merchantLogoImg?.attr('alt')?.trim();

    if (!merchantLogoImg) {
      logger.error('Unable to find merchant name');
      return;
    }

    const merchantUrl = merchantLogoImg?.attr('srcset')?.trim();

    const merchantDomain = merchantUrl
      ? extractDomainFromImageUrl(merchantUrl)
      : null;

    if (!merchantDomain) {
      logger.error(`merchantDomain not found ${request.url}`);
      return;
    }

    let result: ItemResult | undefined;

    for (const item of items) {
      const $cheerio = cheerio.load(item);
      // Extract the voucher title
      const title = $cheerio('p').first()?.text()?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const itemData = {
        title,
        merchantDomain,
        merchantName,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerio);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        await crawler.requestQueue.addRequest(
          {
            url: result.itemUrl,
            userData: {
              ...request.userData,
              label: Label.getCode,
              validatorData: result.validator.getData(),
            },
            headers: CUSTOM_HEADERS,
          },
          { forefront: true }
        );
        continue;
      }

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator: result.validator,
            },
          },
          context
        );
      } catch (error: any) {
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, $, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Extract the coupon code
    const codeSpan = $('span#code');

    if (codeSpan.length === 0) {
      log.warning('Coupon code span is missing');
    }

    const code = codeSpan.text().trim();

    // Check if the code is found
    if (!code) {
      log.warning('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
