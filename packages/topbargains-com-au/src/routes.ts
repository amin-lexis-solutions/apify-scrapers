import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { sleep, ItemResult, getMerchantDomainFromUrl } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any, $cheerio: cheerio.Root): ItemResult {
  let hasCode = false;
  let itemUrl = '';

  const elementButtonLink = $cheerio('div.coupon-cloumn > a').first();

  if (elementButtonLink.length === 0) {
    log.warning('Button link element is missing');
  }

  // Extract idInSite from the data-coupon attribute
  const idInSite = elementButtonLink.attr('data-coupon');

  // innerText of the button link
  const buttonLinkText = elementButtonLink.text().trim();

  // Check if the button link text contains 'View Code'
  if (buttonLinkText.includes('View Code')) {
    hasCode = true;
    itemUrl = item.sourceUrl + '?view_coupon_code=' + idInSite;
  }

  // Extract the description
  const descElement = $cheerio('div.coupon-body');
  let description = '';
  if (descElement.length > 0) {
    description = descElement.text().trim();
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  return { hasCode, itemUrl, validator };
}

export const router = createCheerioRouter();

// TODO: Bug in non-index page detection to resolve
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
      'div.view-coupons-block-store-pages div.main-coupon-wrapper'
    );
    // Extract expired coupons
    const expiredItems = $(
      'div.view-expired-coupons-block-store-pages div.main-coupon-wrapper'
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

    const merchantLogoImgSelector = 'div.store-image.block-center img';

    // Check if valid page
    if (!$(merchantLogoImgSelector).length) {
      log.warning(`Not Merchant URL: ${request.url}`);
    }
    const merchantLogoImg = $(merchantLogoImgSelector);
    let merchantName = '';

    if (merchantLogoImg.length > 0) {
      merchantName = merchantLogoImg.attr('alt')?.trim() || '';
      merchantName = merchantName.replace('promo codes', '').trim();
    }

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const domainUrlLink = $('.field-content a')?.attr('href') || '';

    if (!domainUrlLink) {
      log.warning('Unable to find domain name');
    }

    const merchantDomain = getMerchantDomainFromUrl(domainUrlLink);

    let result: ItemResult | undefined;

    for (const item of items) {
      if ($(item).find('div.coupon-cloumn > a[data-coupon]').length === 0) {
        continue;
      }

      const $cheerioElement = cheerio.load(item);

      const isExpired = !!$cheerioElement('*')
        .parent()
        .hasClass('view-expired-coupons-block-store-pages');
      // Extract the voucher title
      const title = $cheerioElement('h3').first().text().trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const elementButtonLink = $cheerioElement(
        'div.coupon-cloumn > a'
      ).first();

      if (!elementButtonLink) {
        logger.error('ID not found in item');
        continue;
      }

      const itemData = {
        title,
        merchantName,
        merchantDomain,
        isExpired,
        sourceUrl: request.url,
      };
      result = processItem(itemData, $cheerioElement);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        // Add the coupon URL to the request queue
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
        log.warning(`Post-Processing Error : ${error.message}`);
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

    const regex = /\\u003Cspan class=\\u0022get-code\\u0022\\u003E([^\\]+)\\u003C\\\/span\\u003E/;

    const match = $.html().match(regex);

    if (!match) {
      log.warning(`Coupon code span is missing: ${request.url}`);
    }

    const code = match?.[1];

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
