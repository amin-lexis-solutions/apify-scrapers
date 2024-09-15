import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  getMerchantDomainFromUrl,
  ItemResult,
} from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';
import { logger } from 'shared/logger';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(item: any) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);

  // Add optional values to the validator
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusive);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  validator.addValue('idInSite', null);
  validator.addValue('code', item.code);

  const hasCode = !!item?.code;

  return { hasCode, itemUrl: '', validator };
}
// TODO: to inspect it's not working as expected
router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const currentItems = $('li[class^=couponListItem]');

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

    const storeElement = $("script[type='application/ld+json']").text();
    const storeJson = JSON.parse(storeElement);

    const merchantUrl = storeJson.sameAs;

    const merchantName = storeJson?.logo?.name?.replace('Logo', '');

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantDomain = getMerchantDomainFromUrl(merchantUrl);

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    for (const item of items) {
      const title = $(item).find('div.title3').text();

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }

      const code = $(item).find('textarea[class^=copyArea]').text();

      const description = $(item).find('[class^=qualifiers]').text();

      const itemData = {
        code,
        merchantDomain,
        description,
        merchantName,
        sourceUrl: request.url,
        title,
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
        log.error(`Postprocess Error: ${error}`);
      }
      continue;
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
