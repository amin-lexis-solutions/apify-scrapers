import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  getMerchantDomainFromUrl,
  ItemResult,
} from 'shared/helpers';
import { logger } from 'shared/logger';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(item: any) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);

  // Add optional values to the validator
  validator.addValue('code', item.code);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.expiryDateAt));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const itemUrl = ''; // code static HTML

  return { hasCode: item?.hasCode, itemUrl, validator };
}
// TODO Broken Actor always Return the same coupon code for all items in the page
router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const merchantUrl = $(
      '.notion-text-block.css-vhphko .notion-link-token.notion-enable-hover'
    )
      .last()
      .attr('href');

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    const merchantName = merchantDomain?.split('.')?.[0];

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    const currentItems = $(
      '.notion-callout-block.CalloutBlock_container__2uvHL.css-1mtbuw6'
    );
    const expiredItems = [];
    const items = [...currentItems, ...expiredItems];

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            items,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error) {
      logger.error(`Preprocess Error: ${error}`);
      return;
    }

    for (const item of items) {
      const title = $(item).find('.CalloutBlock_title__I1qLM').text();

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }
      const idInSite = $(item).attr('data-block-id');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const code = $('.CodeBlock_block__kCISx.css-qhxz92 button').attr('id');

      const hasCode = !!code;

      const description = $('.notion-text-block').attr('innerText');

      const itemData = {
        merchantDomain,
        merchantName,
        title,
        code,
        idInSite,
        description,
        hasCode,
        sourceUrl: request.url,
      };

      const result: ItemResult = processItem(itemData);

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator: result.validator,
            },
          },
          context
        );
      } catch (error) {
        logger.error(`Postprocess Error: ${error}`);
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
