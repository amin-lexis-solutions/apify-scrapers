import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { sleep, ItemResult, getMerchantDomainFromUrl } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

// TODO : Actor to investigate later
function processItem(item: any, $cheerio: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', !$cheerio.Available);
  validator.addValue('isShown', true);

  if ($cheerio.OfferType !== 'OnlineCode') {
    return { hasCode: false, itemUrl: '', validator };
  }

  const parsedUrl = new URL(item.sourceUrl);

  const itemUrl = `https://${parsedUrl.hostname}/redeem-out/${item.idInSite}?nonInteraction=False&showInterstitial=False`;

  return { hasCode: true, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Extracting the 'props' attribute from the 'view-all-codes' element.
    const propsJson = $('view-all-codes').attr('props');

    if (!propsJson) {
      logger.error('view-all-codes props JSON is missing');
      return;
    }

    const props = JSON.parse(propsJson.replace(/&quot;/g, '"'));

    const merchantName = props.MerchantName;

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const merchantUrl = $('.accordion-mobile-content p a')?.attr('href');

    if (!merchantUrl) {
      log.warning('Unable to find merchantUrl');
    }

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    const items = props.Offers;

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
      await sleep(1000); // Sleep for 1 second between requests to avoid rate limitings

      const idInSite = element.OfferId.toString();

      if (!idInSite) {
        logger.error(`not idInSite found in item`);
        continue;
      }

      const title = element.OfferTitle;

      if (!title) {
        logger.error(`not title found in item`);
        continue;
      }

      const item = {
        idInSite,
        title,
        merchantName,
        merchantDomain,
        isExclusive: items.isExclusive,
        sourceUrl: request.url,
      };

      result = processItem(item, element);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        // Add the coupon URL to the request queue
        await crawler.requestQueue.addRequest(
          {
            url: result.itemUrl,
            userData: {
              ...request.userData,
              label: Label.getCode,
              validatorData: result.validator.getData(),
            },
            headers: CUSTOM_HEADERS,
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

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    if (htmlContent.includes('{')) {
      log.warning(`htmlContent not found in URL: ${request.url}`);
      return;
    }
    // Safely parse the JSON string
    const jsonCodeData = JSON.parse(htmlContent);

    // Validate the necessary data is present
    if (!jsonCodeData || !jsonCodeData.Code) {
      log.warning('Code data is missing in the parsed JSON');
    }

    const code = jsonCodeData.Code;
    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
    validator.addValue('code', code);

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
