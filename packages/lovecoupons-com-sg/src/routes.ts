import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { sleep, getMerchantDomainFromUrl, ItemResult } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function extractAllText(elem: cheerio.Cheerio): string {
  let text = '';
  if (elem.length > 0) {
    text = he
      .decode(elem.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  return text.trim();
}

function processItem(item: any, $cheerio: cheerio.Root): ItemResult {
  const attrDataType = $cheerio('*').first().attr('data-type');

  if (!attrDataType) {
    log.warning('Attr data-type is missing');
  }

  const hasCode = !!(attrDataType === '2');

  let itemUrl = '';

  const attrDataOut = $cheerio('*')?.first()?.attr('data-out');

  if (hasCode && attrDataOut) {
    itemUrl = new URL(attrDataOut?.trim(), item.sourceUrl).href.replace(
      '/go/2/',
      '/go/3/'
    );
  }

  // Extract the description
  const descrElement = $cheerio('article header > p').first();
  const description = extractAllText(descrElement);

  // Extract terms and conditions
  const tocElement = $cheerio('div.TermsConditions').first();
  const toc = extractAllText(tocElement);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('termsAndConditions', toc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  return { hasCode, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`processing URL: ${request.url}`);

    const items = $('article.Offer');

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

    const domainSpan = $('p.BrandUrl > span');

    const merchantDomain =
      domainSpan.length <= 0
        ? null
        : getMerchantDomainFromUrl(domainSpan.text().trim());

    merchantDomain
      ? log.info(`Processing MerchantDomain ${merchantDomain}`)
      : log.warning(`MerchantDomain not found in ${request.url}`);

    // Extract valid coupons
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const merchantElement = $cheerio('*').find('.Outlink img');

      const merchantName = merchantElement
        ? merchantElement?.attr('alt')?.replace(' logo', '')
        : null;

      if (!merchantName) {
        logger.error('Merchant name not found in item');
        continue;
      }

      const idInSite = $cheerio('*').first().attr('data-id')?.trim();

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const titleElement = $cheerio('.Offer h3.Outlink').first();

      if (!titleElement) {
        logger.error('Title not found in item');
        continue;
      }

      const title = extractAllText(titleElement);

      const itemData = {
        title,
        idInSite,
        merchantDomain,
        merchantName,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerio);

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
    const codeInput = $('div.RevealCoupon > input');

    if (codeInput.length === 0) {
      log.warning('Coupon code input is missing');
    }

    const code = codeInput.val().trim();

    // Check if the code is found
    if (!code) {
      log.info('Coupon code not found in the HTML content');
    }

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Add the decoded code to the validator's data
    validator.addValue('code', code);

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator: validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
