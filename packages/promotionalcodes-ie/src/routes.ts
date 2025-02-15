import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { formatDateTime, ItemResult } from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(merchantName, merchantDomain, item, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', item.title);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);
  validator.addValue('code', item.code);

  // there not idInSite in page - lets generate it
  validator.addValue('idInSite', null);

  return { hasCode: !!item.code, itemUrl: '', validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const items = $('section ul li.shrink-0')
      .toArray()
      .map((coupon) => {
        const title = $(coupon).find('a .font-semibold')?.text()?.trim();
        const code = $(coupon)
          .find('.clipboard.border-dashed')
          ?.text()
          ?.replace('Code Copied', '')
          ?.trim();
        const isExpired = $(coupon).hasClass('grayscale');
        return { title, code, isExpired };
      });

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
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    const merchantName = $('#merchant-name').text().split('.')[0];

    if (!merchantName) {
      logger.error(`merchantName not found ${request.url}`);
      return;
    }

    const merchantLogoElement = $('main img').attr('alt');
    const merchantDomain = merchantLogoElement?.includes('.')
      ? merchantLogoElement?.replace(' logo', '')
      : null;

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    for (const item of items) {
      // TDOO :INVESTIGATE why title is not found too often
      if (!item.title) {
        log.warning('title not found in item');
        continue;
      }
      const result: ItemResult = processItem(
        merchantName,
        merchantDomain,
        item,
        request.url
      );

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
