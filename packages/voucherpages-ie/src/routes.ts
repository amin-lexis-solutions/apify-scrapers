import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  formatDateTime,
  generateItemId,
  ItemResult,
  getMerchantDomainFromUrl,
} from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(merchantName, merchantDomain, voucher, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = voucher?.idInSite;
  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', voucher.description);
  validator.addValue('termsAndConditions', voucher.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(
    merchantName,
    voucher.idInSite,
    sourceUrl
  );

  return { generatedHash, hasCode: voucher.hasCode, itemUrl: '', validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const items: any[] = $('.products li.product .woocommerce-LoopProduct-link')
      .toArray()
      .map((item) => $(item).attr('href'));

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

    // Loop for item detail links
    for (const url of items) {
      if (!url) continue;

      log.info(`GetDetail from URL - ${url}`);

      // redirect to detail handler
      await enqueueLinks({
        urls: [url],
        label: Label.details,
      });
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.details, async (context) => {
  // Destructure objects from the context
  const { request, $, log } = context;

  try {
    log.info(`GetDetails Handler - ${request.url}`);

    const merchantName = $('.et_pb_module_inner h1')
      ?.text()
      ?.replace(' Codes', '');

    if (!merchantName) {
      logger.error(`merchantName not found in page - ${request.url}`);
      return;
    }

    const buttonElementHref = $('.single_add_to_cart_button').attr('href');

    let merchantDomainUrl: string | null = null;

    if (buttonElementHref) {
      try {
        const url = new URL(buttonElementHref);
        merchantDomainUrl =
          url.searchParams?.get('url') || url.searchParams?.get('ued');
      } catch (e) {
        log.warning('Not merchantDomainUrl found in page');
      }
    }

    const merchantDomain = merchantDomainUrl
      ? getMerchantDomainFromUrl(merchantDomainUrl)
      : null;

    merchantDomain
      ? log.info(`Processing ${merchantDomain} coupons`)
      : log.warning('Not merchantDomain found in page');

    const idInSite = $('.sku_wrapper span.sku').text().replaceAll('-', '');

    if (!idInSite) {
      logger.error(`idInSite not found in page - ${request.url}`);
      return;
    }

    const title = $('.et_pb_module_inner h2').text();

    if (!title) {
      logger.error(`title not found in page - ${request.url}`);
      return;
    }

    const description = $('.et_pb_tab_content').text().replaceAll('\n', '');

    const elementCode = $('.single_add_to_cart_button').text();

    const hasCode = !elementCode?.includes('View Deals');

    const item = { merchantName, idInSite, title, description, hasCode };

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
    } catch (error: any) {
      logger.error(`Post-Processing Error : ${error.message}`, error);
      return;
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
