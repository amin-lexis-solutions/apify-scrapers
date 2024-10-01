import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { getMerchantDomainFromUrl, ItemResult } from 'shared/helpers';
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
  validator.addValue('description', item.description);

  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('termsAndConditions', item.termsAndConditions);

  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const itemUrl = `https://www.vouchercodes.co.uk/${item.merchantDomain}?rc=${item.idInSite}`;

  return { hasCode: item.hasCode, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const items = $('article.rounded');

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

    const merchantName = $("[data-qa='el:merchantLogo'] img")
      ?.attr('alt')
      ?.replace('Logo', '')
      ?.trim();

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const merchantUrl = request.url;

    if (!merchantUrl) {
      log.warning('Unable to find merchantUrl');
    }

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    let result: ItemResult;

    for (const element of items) {
      const idInSite = $(element).attr('id')?.replace('offer-', '');

      if (!idInSite) {
        logger.error(`not idInSite found in item`);
        continue;
      }

      const title = $(element).find("[data-qa='el:offerTitle']").text();

      if (!title) {
        logger.error(`not title found in item`);
        continue;
      }

      const isExclusive = $(element)
        .find("[data-qa='el:exclusiveTag']")
        ?.text()
        ?.includes('Exclusive');

      const hasCode = $(element)
        .find("[data-qa='el:lozenge']")
        ?.text()
        ?.includes('code');

      const termsAndConditions = $(element)
        .find("[data-qa='el:offerTerms']")
        ?.text();

      const description = $(element).find("[data-qa='el:offerDetails']").text();

      const itemData = {
        merchantDomain,
        merchantName,
        title,
        termsAndConditions,
        idInSite,
        description,
        hasCode,
        isExclusive,
        sourceUrl: request.url,
      };

      result = processItem(itemData);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        // Add the coupon URL to the request queue
        await crawler?.requestQueue?.addRequest(
          {
            url: result.itemUrl,
            userData: {
              ...request.userData,
              label: Label.getCode,
              validatorData: result.validator.getData(),
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
  const { request, $ } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const code = $('[data-qa="el:offerFront"] [data-qa="el:code"]').text();

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
    if (code) validator.addValue('code', code);

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
