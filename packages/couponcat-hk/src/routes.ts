import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { getMerchantDomainFromUrl, ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import { formatDateTime } from '../../shared/src/helpers';

function processItem(item: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);
  validator.addValue('expiryDateAt', formatDateTime(item.expiryDateAt));

  const itemUrl = item.pathname ? `https://couponcat.hk${item.pathname}` : '';

  return { hasCode: item.hasCode, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const items = $('.cards .card');

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

    const merchantName = $('.company-logo').attr('alt')?.trim();

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }

    const innerHtmlLink = $('.shop-now').attr('href');

    const merchantUrl = innerHtmlLink
      ? new URL(innerHtmlLink).searchParams.get('vc_url')?.split('&')?.[0]
      : null;

    if (!merchantUrl) {
      log.warning('Unable to find merchantUrl');
    }

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    let result: ItemResult;

    for (const element of items) {
      const title = $(element).find('.coupon-title').text();

      if (!title) {
        logger.error(`not title found in item`);
        continue;
      }

      const description = $(element).find('.content-inner.description').text();

      const pathname = $(element).find('.coupon.redirect-link').attr('href');

      const hasCode = !!pathname;

      const idInSite = pathname?.split('coupon_id=')?.[1];

      const expiryDateAt = $(element).find('.card-content .deadline').text();

      const itemData = {
        title,
        merchantDomain,
        merchantName,
        idInSite,
        pathname,
        description,
        hasCode,
        expiryDateAt,
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

    const code = $('.code #copyto').text();

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
