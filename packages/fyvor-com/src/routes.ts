import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import * as he from 'he';
import * as buffer from 'buffer';
import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateItemId,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
  getMerchantDomainFromUrl,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any, $cheerioElement: cheerio.Root): ItemResult {
  const dataType = $cheerioElement('*').first().attr('data-type')?.trim();

  if (!dataType) {
    log.warning('Element data-type attr is missing');
  }

  const isExpired = $cheerioElement('*')
    .parent()
    .attr('class')
    ?.includes('expired');

  const hasCode = dataType === 'code';

  const itemUrl = hasCode ? `${item.sourceUrl}?promoid=${item.idInSite}` : '';

  // Extract the description
  const descElement = $cheerioElement('*[itemprop="description"]');
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
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, hasCode, itemUrl, validator };
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

    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const activedItems = $('div.c_list:not(.expired) > div[itemprop="offers"]');
    const expiredItems = $('div.c_list.expired > div[itemprop="offers"]');

    const items = [...activedItems, ...expiredItems];

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

    const merchantLink = $('div.page_link_n > div > span');

    const merchantName = he.decode(
      merchantLink ? merchantLink.text().trim() : ''
    );

    if (!merchantName) {
      logger.error('Merchant name is missing');
      return;
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    if (!merchantDomain) {
      log.warning('Domain is missing');
    }

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult | undefined;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const idAttr = $cheerio('*').first().attr('id')?.trim();

      if (!idAttr) {
        logger.error('idInSite not found in item');
        continue;
      }

      const idInSite = idAttr.split('_').pop();

      // Extract the voucher title
      const title = $cheerio('div.coupon_word > a.coupon_title')
        ?.first()
        ?.text()
        ?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const itemData = {
        title,
        merchantName,
        merchantDomain,
        idInSite,
        sourceUrl: request.url,
      };

      result = processItem(itemData, $cheerio);

      if (result.hasCode) {
        itemsWithCode[result.generatedHash] = result;
        idsToCheck.push(result.generatedHash);
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

    // Call the API to check if the coupon exists
    const nonExistingIds = await checkItemsIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;

    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
      // Add the coupon URL to the request queue
      await crawler?.requestQueue?.addRequest(
        {
          url: currentResult.itemUrl,
          userData: {
            label: Label.getCode,
            validatorData: currentResult.validator.getData(),
          },
          headers: CUSTOM_HEADERS,
        },
        { forefront: true }
      );
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

    const NodeSuffix = 'p';
    const regex = /\s+xxh_([^"]+)/;
    const keys = ['f', 's', 't'];
    const classValues: string[] = [];

    // Class names of these 3 elements are needed to extract the coupon code encrypted parts
    for (const key of keys) {
      const classValue = $(`#${key}${NodeSuffix}`)
        .first()
        .attr('class')
        ?.trim();
      if (!classValue) {
        log.warning(`Coupon code part ${key} class attr is missing`);
        return;
      }
      classValues.push(classValue);
    }

    // Extract the coupon code encrypted parts
    const parts: string[] = [];
    let i = 0;
    for (const classValue of classValues) {
      const part = classValue.match(regex);
      if (!part || !part[1]) {
        log.warning(`Coupon code part ${keys[i]} is missing`);
        return;
      }
      parts.push(part[1]);
      i++;
    }

    const encodedString = parts.join('');

    // Decode the coupon code twice

    // First decode
    const intermediateString = buffer.Buffer.from(
      encodedString,
      'base64'
    ).toString('ascii');

    // Second decode
    const code = buffer.Buffer.from(intermediateString, 'base64').toString(
      'ascii'
    );

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
