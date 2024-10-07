import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);
  validator.addValue('code', item.code);

  return { hasCode: !!item.code, itemUrl: '', validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const script = $('#__NEXT_DATA__').html();

    const json = JSON.parse(script || '{}');

    const json_data = json?.props?.pageProps?.data;

    const activeItems = json_data?.coupons;
    const expiredItems = json_data?.expired_coupons;
    const items = [...activeItems, ...expiredItems];

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

    const merchantName = json_data?.store?.brand_name;

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const merchantDomain = json_data?.store?.domain;

    let result: ItemResult;

    for (const element of items) {
      if (!element.coupon_id) {
        logger.error(`not idInSite found in item`);
        continue;
      }

      if (!element.title) {
        logger.error(`not title found in item`);
        continue;
      }

      const item_data = {
        merchantDomain,
        merchantName,
        sourceUrl: request.url,
        idInSite: element.coupon_id,
        title: element.title,
        isExpired: !element.not_expired,
        code: element.coupon_code,
      };

      result = processItem(item_data);

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
        log.warning(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
