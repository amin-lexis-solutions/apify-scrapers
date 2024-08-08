import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { ItemHashMap, ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import { generateHash } from 'shared/helpers';

async function processItem(item: any, $cheerioElement: cheerio.Root) {
  // Extract the description
  const description = $cheerioElement('div.item-desc-wrapper div.item-desc')
    .text()
    .trim();

  const isExpired = $cheerioElement('*')
    .attr('class')
    ?.includes('expired-item');
  // Extract the code

  const codeElement = isExpired
    ? $cheerioElement(
        'div.coupon-info > div.item-title > span.coupon-code > span.code'
      )
    : $cheerioElement(
        'button.item-code > span.item-promo-block > span.item-code-link'
      );

  const code = codeElement.length > 0 ? codeElement.text().trim() : null;

  const hasCode = !!code;
  // Determine if the coupon isExclusive
  const exclusiveElement = $cheerioElement(
    'div.coupon-info > div.coupon-info-complement > div.couponStatus > span.couponStatus-item'
  );
  const exclusiveText =
    exclusiveElement.length > 0 ? exclusiveElement.text().toUpperCase() : '';
  const isExclusive = exclusiveText.includes('EXCLUSIVO');

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('description', description);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  code ? validator.addValue('code', code) : null;

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, validator, itemUrl: '', hasCode };
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Processing URL: ${request.url}`);

    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    // Refactor to use a loop for valid coupons
    const currentItems = $('ul.coupon-list.valid-coupons > li[data-id]');
    const expiredItems = $('ul.coupon-list.expired-coupons > li[data-id]');
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

    const merchantName = (
      $('div.storeHeader').attr('data-store-name') ||
      $('.item-title h3').attr('data-label')
    )?.toLowerCase();

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const itemsWithCode: ItemHashMap = {};
    const idsToCheck: string[] = [];
    let result: ItemResult;

    for (const item of items) {
      const $cheerio = cheerio.load(item);

      // Retrieve 'data-id' attribute
      const idInSite =
        $cheerio('*').attr('data-id') || $cheerio('*').attr('id');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const title = $cheerio('div.coupon-info > div.item-title > h3')
        ?.text()
        .trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const itemData = {
        title,
        idInSite,
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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
