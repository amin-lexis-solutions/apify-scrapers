import { logger } from 'shared/logger';
import { createCheerioRouter } from 'crawlee';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { formatDateTime } from 'shared/helpers';

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
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const itemUrl = `https://www.acties.nl/store-offer/ajax-popup/${item.idInSite}/${item.storeId}`;

  return { hasCode: item.hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;
  if (request.userData.label !== Label.listing || !crawler.requestQueue) return;

  try {
    log.info(`Listing ${request.url}`);

    const scriptContent = $('script')
      .filter((i, el) => {
        const htmlContent = $(el).html()?.trim();
        return !!htmlContent && htmlContent.startsWith('window._store');
      })
      .html();

    let pageDataJson: any = null;

    if (scriptContent) {
      // Extract the JSON part of the script content
      const pageDataMatch = scriptContent.match(
        /window\._store\s*=\s*(\{[^;]+\});/
      );

      if (pageDataMatch && pageDataMatch[1]) {
        const jsonString = pageDataMatch[1];

        try {
          pageDataJson = JSON.parse(jsonString);
        } catch (error) {
          logger.error('Failed to parse JSON from window._store:', error);
          return;
        }
      } else {
        logger.error('window._store not found in the script');
        return;
      }
    } else {
      logger.error('Script content not found');
      return;
    }

    if (!pageDataJson || !pageDataJson?.id) {
      logger.error('Page data not found or missing id');
      return;
    }

    const merchantName =
      $('#store-logo').attr('title')?.trim() || pageDataJson?.slug || null;

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantDomain =
      $('#store-topbar .link').text() ||
      $('#store-topbar li[clas]').text() ||
      null;

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning(`Merchant Domain not found for ${request.url}`);

    const items = $('section.active article, section.expired article')
      .map((_, el) => {
        const $el = $(el);
        let expiryDateAt: string | null = $el.find('.date-end').text().trim();
        if (expiryDateAt === 'Verloopt morgen') {
          expiryDateAt =
            new Date(new Date().setDate(new Date().getDate() + 1))
              .toISOString()
              .split('T')[0] || null;
        }
        return {
          storeId: pageDataJson.id,
          sourceUrl: request.url,
          merchantName,
          merchantDomain,
          title: $el.find('h3').text().trim(),
          idInSite: $el.attr('data-offer-id'),
          description: $el.find('.details').text().trim(),
          termsAndConditions: $el.find('.terms').text().trim(),
          expiryDateAt,
          startDateAt: null,
          isExclusive: $el.hasClass('special'),
          isExpired: $el.hasClass('expired'),
          hasCode: $el.hasClass('coupon'),
        };
      })
      .get() as any[] | [];

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
      if (!item.title || !item.merchantName || !item.idInSite) {
        log.warning('Item title or merchantName not found');
        continue;
      }

      const result = processItem(item);

      if (result.hasCode) {
        if (!result.itemUrl) continue;

        await crawler.requestQueue.addRequest(
          {
            url: result.itemUrl,
            userData: {
              ...request.userData,
              label: Label.getCode,
              validatorData: result.validator.getData(),
            },
            headers: {
              ...CUSTOM_HEADERS,
              'X-Requested-With': 'XMLHttpRequest',
            },
          },
          { forefront: true }
        );
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
      } catch (error) {
        log.error(`Postprocess Error: ${error}`);
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

// TODO: Implement the handler for the getCode label if needed
router.addHandler(Label.getCode, async (context) => {
  // Destructure objects from the context
  const { request, $, log } = context;

  try {
    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);

    const code =
      $('.copy-code').attr('data-clipboard-text') ||
      $('.code-select').text().trim() ||
      null;

    if (!code) {
      log.warning('No code found');
    }

    if (code && code.includes(' ')) {
      log.warning(`Code contains spaces, to inspect: ${code}`);
    }

    // Add the code value to the validator
    validator.addValue('code', code);

    try {
      await postProcess(
        {
          SaveDataHandler: { validator },
        },
        context
      );
    } catch (error) {
      log.error(`Postprocess Error: ${error}`);
      return;
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
