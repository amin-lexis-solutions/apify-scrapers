import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  ItemResult,
  getMerchantDomainFromUrl,
  formatDateTime,
} from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import jp from 'jsonpath';

function processItem(item: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('expiryDateAt', formatDateTime(item.expiryDateAt));
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isShown', true);

  const parsedUrl = new URL(item.sourceUrl);

  const itemUrl = `https://${parsedUrl.hostname}/redeem-out/${item.idInSite}?nonInteraction=False&showInterstitial=False`;

  return { hasCode: true, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const scriptContent =
      $('script[type="application/ld+json"]').first().html() || '{}';

    const jsonData = JSON.parse(scriptContent) || {};

    const merchantUrl =
      jp.query(jsonData, `$..[?(@["@type"] == 'Brand')].url`)[0] ||
      $('.accordion-mobile-content p a')?.attr('href') ||
      null;

    const merchantName =
      jp.query(jsonData, `$..[?(@["@type"] == 'Brand')].name`)[0] ||
      $('.tile-signup-logo-image')?.attr('alt') ||
      null;

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    if (!merchantUrl) {
      log.warning('Unable to find merchantUrl');
    }

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    const items = $('.tile[data-type]')
      .map((_, el) => {
        const footerContent = $(el).find('.tile-footer').text();

        const expiryDateAt =
          footerContent?.match(/(\d{2}-\d{2}-\d{2})/)?.[0] || null;

        const $redeem_button = $(el)
          .find('redeem-button')
          .first()
          .attr('props');
        const objectDtat = JSON.parse(
          $redeem_button?.replace(/&quot;/g, '"') || '{}'
        );
        return {
          idInSite: jp.query(objectDtat, '$..offerId')[0],
          title: jp.query(objectDtat, '$..offerTitle')[0],
          termsAndConditions: null,
          expiryDateAt,
          merchantName: jp.query(objectDtat, '$..merchantName')[0],
          merchantDomain,
          hasCode: jp.query(objectDtat, '$..redemptionType')[0] === 'Code',
          itemUrl: jp.query(objectDtat, '$..redeemUrl')[0],
          termsUrl: $(el).find('.tile-terms').attr('data-redemption-modal'),
          isExclusive: jp.query(objectDtat, '$..isExclusive')[0] === 'true',
          isShown: true,
          isExpired: jp.query(objectDtat, '$..available')[0] === 'true',
          sourceUrl: request.url,
        };
      })
      .get();

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

    for (const item of items) {
      if (!item.title || !item.idInSite) {
        log.warning('Skipping item due to missing title or idInSite');
        continue;
      }

      const { validator } = processItem(item);

      if (item.hasCode) {
        if (!item.itemUrl) continue;

        const redeemUrl = new URL(item.itemUrl, request.url).href;

        await enqueueLinks({
          label: Label.getCode,
          urls: [redeemUrl],
          forefront: true,
          userData: {
            ...request.userData,
            validatorData: validator.getData(),
          },
          transformRequestFunction: (req) => {
            req.method = 'POST';
            req.headers = {
              ...CUSTOM_HEADERS,
              ...request.headers,
              'Content-Type': 'application/json; charset=utf-8',
            };
            return req;
          },
        });
        continue;
      }

      if (item.termsUrl) {
        const termsUrl = new URL(item.termsUrl, request.url).href;

        await enqueueLinks({
          label: Label.details,
          urls: [termsUrl],
          forefront: true,
          userData: {
            ...request.userData,
            validatorData: validator.getData(),
          },
          transformRequestFunction: (req) => {
            req.method = 'POST';
            req.headers = {
              ...CUSTOM_HEADERS,
              ...request.headers,
              'Content-Type': 'application/json; charset=utf-8',
            };
            return req;
          },
        });
        continue;
      }

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator: validator,
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

router.addHandler(Label.details, async (context) => {
  // context includes request, body, etc.
  const { request, body, log } = context;

  if (request.userData.label !== Label.details) return;

  try {
    logger.info(`Processing URL: ${request.url}`);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body.toString();

    // Safely parse the JSON string
    const responseJson = JSON.parse(htmlContent) || {};

    if (!responseJson) {
      log.error(`Failed to parse JSON response at: ${htmlContent}`);
      return;
    }

    const html = jp.query(responseJson, '$..Html')[0] || '';

    // convert the HTML string to a Cheerio object
    const $ = cheerio.load(html);

    // Assuming the code should be added to the validator's data
    validator.addValue(
      'termsAndConditions',
      $('.section-terms-list')?.text() || null
    );

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    logger.info(`Processing URL: ${request.url}`);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body.toString();

    // Safely parse the JSON string
    const responseJson = JSON.parse(htmlContent) || {};

    if (!responseJson) {
      log.error(`Failed to parse JSON response at: ${htmlContent}`);
      return;
    }

    const code = jp.query(responseJson, '$..Code')[0] || null;
    const html = jp.query(responseJson, '$..Html')[0] || '';

    // convert the HTML string to a Cheerio object
    const $ = cheerio.load(html);

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
    validator.addValue('code', code);
    validator.addValue(
      'termsAndConditions',
      $('.section-terms-list')?.text() || null
    );

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
