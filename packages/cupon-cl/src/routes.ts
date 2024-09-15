import { createPuppeteerRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { logger } from 'shared/logger';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  getMerchantDomainFromUrl,
  ItemResult,
} from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processItem(item) {
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
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const hasCode = item.hasCode;

  const itemUrl = `https://cupon.cl/modals/coupon_clickout?id=${item.idInSite}`;

  return { hasCode, itemUrl, validator };
}

// TODO: convert to cheerio
router.addHandler(Label.listing, async (context) => {
  const { request, page, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const currentItems = await page.$$('.coupons__item');
    const expiredItems = []; // There is not item expired on page
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

    const merchantName = await page.evaluate(() => {
      return document
        .querySelector('.fallback_link')
        ?.getAttribute('data-shop');
    });

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantUrl = request.url;
    const merchantDomain = getMerchantDomainFromUrl(merchantUrl);

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    for (const itemHandle of items) {
      const title = await page.evaluate((node) => {
        return node?.querySelector('.coupon__title')?.textContent;
      }, itemHandle);

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }

      const idInSite = await page.evaluate((node) => {
        return node
          ?.querySelector('.coupon__title')
          ?.getAttribute('data-coupon-id');
      }, itemHandle);

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const description = await page.evaluate((node) => {
        return node?.querySelector('.coupon__description')?.textContent;
      }, itemHandle);

      const hasCode = await page.evaluate((node) => {
        return !!node?.querySelector('.coupon__label-code');
      }, itemHandle);

      const itemData = {
        merchantDomain,
        merchantName,
        title,
        description,
        hasCode,
        idInSite,
        sourceUrl: request.url,
      };

      const result: ItemResult = processItem(itemData);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        await enqueueLinks({
          urls: [result.itemUrl],
          userData: {
            ...request.userData,
            label: Label.getCode,
            validatorData: result.validator.getData(),
          },
          forefront: true,
          transformRequestFunction: (request) => {
            request.keepUrlFragment = true;
            request.method = 'POST'; // This is a POST request
            request.payload = JSON.stringify({});
            return request;
          },
        });

        log.info(`Enqueued code page: ${result.itemUrl}`);
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

router.addHandler(Label.getCode, async (context) => {
  try {
    // Destructure objects from the context
    const { request, page, log } = context;

    log.info(`GetCode ${request.url}`);

    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);

    // get page content

    const modalElement = await page.$('.modal__code-wrap');

    // Get the data-clipboard-target attribute value from the copy button
    const clipboardTarget = await page.evaluate((node) => {
      const button = node?.querySelector('button.modal-clickout__copy');
      return button ? button.getAttribute('data-clipboard-target') : null;
    }, modalElement);

    if (clipboardTarget) {
      // Get the code from the modal using the clipboard target selector
      const code = await page.evaluate(
        (node, target) => {
          return node?.querySelector(target)?.textContent?.trim();
        },
        modalElement,
        clipboardTarget
      );

      if (!code) {
        log.warning('No code found');
      } else {
        log.info(`Found code: ${code}`);
      }

      // Add the code value to the validator
      validator.addValue('code', code);
    }

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
