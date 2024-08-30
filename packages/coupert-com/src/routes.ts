import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { formatDateTime } from 'shared/helpers';
import { logger } from 'shared/logger';

import { preProcess, postProcess } from 'shared/hooks';
import jp from 'jsonpath';

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
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.restrict);
  validator.addValue('expiryDateAt', formatDateTime(item.expire_time));
  validator.addValue('startDateAt', formatDateTime(item.start_time));
  validator.addValue('isExclusive', null);
  validator.addValue('isExpired', null);
  validator.addValue('isShown', true);
  validator.addValue('code', item.code);

  return { validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    // Extract the page data from the __NUXT_DATA__ script content
    const nuxtDataScript = $('script#__NUXT_DATA__').text() || '{}';
    const nuxtData = JSON.parse(nuxtDataScript);

    if (Array.isArray(nuxtData) && nuxtData.length === 0) {
      logger.error('Page data not found');
      return;
    }
    // reverse engineer the page data
    const page_data = nuxtData.reduce((longest, item) => {
      if (typeof item === 'string' && item.length > longest.length) {
        try {
          const decodedItem = JSON.parse(
            Buffer.from(item, 'base64').toString()
          );
          return decodedItem;
        } catch (error) {
          return item;
        }
      }
      return longest;
    }, '');

    // page data js object with merchant_coupons

    if (!page_data || !page_data.merchant_coupons) {
      logger.error(`Page data not found ${request.url}`);
      return;
    }

    const merchantName = jp.query(page_data, '$.info.name')?.[0];

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantDomain = jp.query(page_data, '$.info.domain')?.[0];

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    const items = jp.query(page_data, '$.merchant_coupons[*]') || [];

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
      const itemData = {
        ...item,
        idInSite: item.id.toString(),
        merchantDomain: item.domain,
        merchantName,
        sourceUrl: request.url,
      };

      const { validator } = processItem(itemData);

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator,
            },
          },
          context
        );
      } catch (error) {
        log.error(`Postprocess Error: ${error}`);
      }
    }

    log.info(`Processed ${items.length} items from ${request.url}`);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
