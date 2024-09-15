import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import * as he from 'he';
import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { sleep, ItemResult, getMerchantDomainFromUrl } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  'X-Requested-With': 'XMLHttpRequest',
};

function processItem(item: any, $cheerio: cheerio.Root): ItemResult {
  const configAttr = $cheerio('*').first().attr('data-voucher-config-value');

  if (!configAttr) {
    log.warning('Attribute data-voucher-config-value is missing');
  }

  const config = JSON.parse(configAttr || '{}');

  // Extract the voucher id

  const hasCode = config.type === 1;
  let itemUrl = '';

  if (hasCode) {
    // Extract domain from the source URL by parsing the URL
    const sourceUrlObj = new URL(item.sourceUrl);
    const sourceDomain = sourceUrlObj.hostname;
    itemUrl = `https://${sourceDomain}/async/voucher-modal?id=${item.idInSite}`;
  }

  // Extract the description
  let description = '';
  const descElement = $cheerio('ul.voucherCard-details').first();
  if (descElement.length > 0) {
    description = he
      .decode(descElement.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  return { hasCode, itemUrl, validator };
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

    log.warning(`Listing ${request.url}`);

    // Extract valid coupons
    const currentItems = $(
      'div.voucherGroup div.voucherCard:not(.voucherCard--expired)'
    );
    const expiredItems = $(
      'div.voucherGroup div.voucherCard.voucherCard--expired'
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

    const merchantLogoImgSelector = 'div.shopHeader img.shopLogo';

    // Check if valid page
    if (!$(merchantLogoImgSelector).length) {
      log.warning(`Not Merchant URL: ${request.url}`);
    }
    const merchantLogoImg = $(merchantLogoImgSelector);
    let merchantName = '';

    if (merchantLogoImg.length > 0) {
      merchantName = merchantLogoImg.attr('title')?.trim() || '';
    }

    if (!merchantName) {
      logger.error('Unable to find merchant name');
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('domain name is missing');
    }

    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const isExpired = $cheerio('*').hasClass('voucherCard--expired');
      // Extract the voucher title
      const title = $cheerio('span.voucherCard-hubTitleTextMain')
        .first()
        ?.text()
        ?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const configAttr = $cheerio('*')
        .first()
        .attr('data-voucher-config-value');

      if (!configAttr) {
        logger.error('Attribute data-voucher-config-value not found in item');
        continue;
      }

      const config = JSON.parse(configAttr);

      const idInSite = config?.id?.toString();

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantDomain,
        merchantName,
        isExpired,
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
            headers: CUSTOM_HEADERS_LOCAL,
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
  const { request, $ } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const codeElement = $('span[data-voucher-modal-target="code"]');

    if (!codeElement) {
      log.warning(`Unable to find code element in the page: ${request.url}`);
    }
    const code = codeElement.text().trim();

    // Check if the code is found
    if (!code) {
      log.warning(`Coupon code not found in the HTML content: ${request.url}`);
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
