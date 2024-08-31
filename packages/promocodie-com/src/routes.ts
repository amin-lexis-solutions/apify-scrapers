import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { formatDateTime } from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';
import { logger } from 'shared/logger';
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
  validator.addValue('isExclusive', item?.isExclusive);
  validator.addValue('isExpired', item?.isExpired);
  validator.addValue('isShown', true);
  validator.addValue('code', item.code);

  return { validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Start processing ${request.url}`);

    // Find the script tag that contains the window.__NUXT__ object
    const scriptContent = $('script')
      .filter((i, el) => {
        const htmlContent = $(el).html()?.trim();
        return (
          !!htmlContent && htmlContent.startsWith('window.__NUXT__=(function')
        );
      })
      .html();

    let pageDataJson: any = null;

    if (scriptContent) {
      // Extract the JSON part of the script content
      const pageDataMatch = scriptContent.match(/pageData:"([^"]+)"/);

      if (pageDataMatch && pageDataMatch[1]) {
        const encodedPageData = pageDataMatch[1];

        try {
          // Decode the Base64 encoded pageDataß
          pageDataJson = JSON.parse(
            Buffer.from(encodedPageData, 'base64').toString('utf-8')
          );
        } catch (error) {
          logger.error('Failed to decode pageData:', error);
          return;
        }
      } else {
        logger.error('pageData not found in the script');
        return;
      }
    } else {
      logger.error('Nuxt data not found');
      return;
    }

    const merchantName = jp.query(pageDataJson, '$.info.merchant_name')[0];

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantDomain = jp.query(pageDataJson, '$.info.domain')[0];

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    const currentItems =
      jp.query(pageDataJson, '$.merchant_coupons')?.[0] || [];
    const expiredItems = jp.query(pageDataJson, '$.expired_coupons')?.[0] || [];
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
      const itemData = {
        ...item,
        idInSite: item.id || item.upk,
        merchantDomain,
        merchantName,
        sourceUrl: request.url,
      };

      const { validator } = processItem(itemData);

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator: validator,
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
