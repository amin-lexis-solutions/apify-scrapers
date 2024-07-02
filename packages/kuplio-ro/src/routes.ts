import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  checkItemsIds,
  ItemHashMap,
  ItemResult,
  generateHash,
  logError,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function extractAndFormatDate(input: string | null): string | null {
  if (!input) return null;

  // Use a regular expression to extract the date portion of the string
  const dateRegex = /\d{2}\.\d{2}\.\d{4}/;
  const match = input.match(dateRegex);

  if (match) {
    // Split the date into [day, month, year]
    const [day, month, year] = match[0].split('.');

    // Format the date into YYYY-MM-DD
    const formattedDate = `${year}-${month}-${day}`;
    return formattedDate;
  }
  return null;
}

async function processItem(item: any, $cheerio: cheerio.Root) {
  const elemCode = $cheerio('div.hidden-code').first();

  const hasCode = !!(elemCode?.length > 0);

  // Extract the description
  let description = null;
  const descElement = $cheerio('div.main > p').first();
  if (descElement.length !== 0) {
    description = he.decode(descElement.text().trim());
  }

  // Extract the expiration date
  let expiryDateAt;
  const expiryElement = $cheerio(
    'div.main > div.footer > div.expiration'
  ).first();
  if (expiryElement.length !== 0) {
    expiryDateAt = he.decode(expiryElement.text().trim());
    expiryDateAt = extractAndFormatDate(expiryDateAt);
  } else {
    expiryDateAt = null;
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('expiryDateAt', expiryDateAt);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const code = elemCode?.text()?.trim();

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, hasCode, itemUrl: '', validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logError('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantDomain = $('.contacts .details .link')
      ?.attr('href')
      ?.split('@')?.[1];

    if (!merchantDomain) {
      log.warning(`merchantDomain not found in sourceUrl ${request.url}`);
    }
    // Extract valid coupons
    const items = $('div#couponContainer > div.coupon');

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
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    // Extract items
    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      const idInSite = $cheerio('*').first().attr('data-id');

      if (!idInSite) {
        logError(`Element data-id attr is missing in ${request.url}`);
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('div.main > h2').first()?.text()?.trim();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const merchantName = $cheerio('div.main > span.shop')
        .first()
        ?.text()
        ?.trim();

      if (!merchantName) {
        logError('Merchant name not found in item');
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantDomain,
        merchantName,
        sourceUrl: request.url,
      };

      result = await processItem(itemData, $cheerio);

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
        logError(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
    // Call the API to check if the coupon exists
    const nonExistingIds = await checkItemsIds(idsToCheck);

    if (nonExistingIds.length == 0) return;

    let currentResult: ItemResult;

    for (const id of nonExistingIds) {
      currentResult = itemsWithCode[id];
      // Enqueue the coupon URL for further processing with appropriate label and validator data
      await postProcess(
        {
          SaveDataHandler: {
            validator: currentResult.validator,
          },
        },
        context
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
