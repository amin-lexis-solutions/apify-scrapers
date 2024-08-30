import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateItemId,
  getMerchantDomainFromUrl,
  ItemResult,
} from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';
import { logger } from 'shared/logger';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(item) {
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
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);
  validator.addValue('code', item.code);

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  return { generatedHash, hasCode: item.hasCode, itemUrl: '', validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const merchantName = $('.rh-mini-sidebar img').attr('alt');

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      return;
    }

    const merchantLink = $('.rh-mini-sidebar .blockstyle').attr('href');
    const merchantUrl = merchantLink
      ? new URL(merchantLink).searchParams.get('url')
      : null;

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    merchantDomain
      ? log.info(
          `Merchant Name: ${merchantName} - merchantDomain: ${merchantDomain}`
        )
      : log.warning('merchantDomain not found');

    const currentItems = [...$('.rh_offer_list')];
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
      const title = $(item).find('.woo_list_desc h2').text();

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }
      const idInSite = $(item).find('.coupon_btn').attr('data-codeid');

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const description = $(item).find('.rh_gr_middle_desc').text();

      const code = $(item).find('.coupon_btn').attr('data-clipboard-text');

      const hasCode = !!code;

      const itemData = {
        title,
        description,
        merchantDomain,
        code,
        idInSite,
        hasCode,
        merchantName,
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
        log.error(`Postprocess Error: ${error}`);
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
