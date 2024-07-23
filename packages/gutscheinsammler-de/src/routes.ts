import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  sleep,
  generateItemId,
  checkItemsIds,
  ItemResult,
  ItemHashMap,
  getMerchantDomainFromUrl,
  logError,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

const CUSTOM_HEADERS_LOCAL = {
  ...CUSTOM_HEADERS,
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
};

function processItem(item: any, $cheerio: cheerio.Root): ItemResult {
  const validator = new DataValidator();

  const buttonElement = $cheerio(
    'button[data-testid="VoucherShowButton"] > p'
  ).first();

  const buttonText = buttonElement?.text()?.trim();

  const hasCode = !!buttonText?.toUpperCase()?.includes('ZUM GUTSCHEIN');

  const isExpired = $cheerio('*').attr('class')?.includes('expired');

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  const itemUrl = hasCode
    ? `https://www.gutscheinsammler.de/api/voucher/${item.idInSite}`
    : '';

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
    log.warning('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantName = $('.ShopSummary_title__U9dPv')
      .text()
      ?.replace(' Coupons', '');

    if (!merchantName) {
      logError(`merchantName not found in URL: ${request.url}`);
      return;
    }

    const merchantDomainLink = $(
      'div[data-testid="ShopDetails"] .ShopDetailsList_link__ZYqnc'
    )
      .first()
      .text();

    const merchantDomain = merchantDomainLink
      ? getMerchantDomainFromUrl(merchantDomainLink)
      : null;

    if (!merchantDomain) {
      log.warning(`merchantDomain not found ${request.url}`);
    }

    // Extract valid coupons
    const activedItems = $(
      'section[data-testid=ActiveVouchers] div[data-testid=VouchersListItem]'
    );
    const expiredItems = $(
      "section[data-testid='ExpiredVouchers'] div[data-testid='VouchersListItem']"
    );

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
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const element of items) {
      const $cheerio = cheerio.load(element);

      const idInSite = $cheerio('*')?.first()?.attr('data-voucherid');

      if (!idInSite) {
        logError('idInSite not found in item');
        continue;
      }

      // Extract the voucher title
      const title = $cheerio('button[class*="VouchersListItem_titleButton"]')
        ?.first()
        ?.text()
        ?.trim();

      if (!title) {
        logError('title not foun in item');
        continue;
      }

      const item = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = processItem(item, $cheerio);

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
      // Add the coupon URL to the request queue
      await crawler?.requestQueue?.addRequest(
        {
          url: currentResult.itemUrl,
          userData: {
            label: Label.getCode,
            validatorData: currentResult.validator.getData(),
          },
          headers: CUSTOM_HEADERS_LOCAL,
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
  const { request, body, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    if (!htmlContent.includes('{')) {
      return;
    }

    // Attempt to parse the HTML content as JSON
    const parsedJson = JSON.parse(htmlContent);

    const code = parsedJson?.code?.trim();

    log.info(`Found code: ${code}\n    at: ${request.url}`);

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
