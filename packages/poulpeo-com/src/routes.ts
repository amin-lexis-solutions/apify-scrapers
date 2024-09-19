import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { ItemResult, formatDateTime } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import jp from 'jsonpath';

function processItem(item: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.expiryDateAt));
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('code', item.code);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  return { hasCode: item.code, itemUrl: '', validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const scriptContent =
      $('script[type="application/ld+json"]').first().text() || '{}';

    const jsonData = JSON.parse(scriptContent) || {};

    const merchantName =
      jp.query(jsonData, `$..[?(@['@type'] == 'LocalBusiness')]['name']`)[0] ||
      $('.m-pageHeader__logo img , ').attr('alt') ||
      $('.m-merchantReviewsHeader__logo img').attr('alt');

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const merchantDomain = null;

    const items =
      $('.m-offer')
        .map((index, element) => {
          const $element = $(element);

          // Extract Base64-encoded string and decode it to JSON
          const base64Redirections = $element.attr('data-redirections');
          const couponJson = base64Redirections
            ? JSON.parse(
                Buffer.from(base64Redirections, 'base64').toString('utf-8')
              )
            : null;

          // Extract code from the payload
          const code = couponJson
            ? jp.query(
                couponJson,
                `$..[?(@['t'] == 'clipboard')]['c'].value`
              )[0] || null
            : null;

          // Extract terms and conditions
          const termsAndConditions = $element.find('.m-offer__details').text();

          // Extract and format expiring date
          const expiringDateMatch = termsAndConditions.match(
            /(\d{2}\/\d{2}\/\d{4})/
          );
          const expiryDateAt = expiringDateMatch ? expiringDateMatch[1] : '';

          // Return the structured item
          return {
            title: $element.find('.m-offer__title').text(),
            idInSite: $element.attr('data-offer-id'),
            code,
            sourceUrl: request.url,
            merchantName,
            merchantDomain,
            termsAndConditions,
            expiryDateAt,
          };
        })
        .get() || [];

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

    let result: ItemResult;

    for (const element of items) {
      if (!element.idInSite || !element.title) {
        logger.warning(
          `Skipping item with missing data idInSite: ${element.idInSite} title: ${element.title} \n ${request.url}`
        );
        continue;
      }

      result = processItem(element);

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
