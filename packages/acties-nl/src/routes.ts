import { logger } from 'shared/logger';
import { createPuppeteerRouter, sleep } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  generateItemId,
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
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  const generatedHash = generateItemId(
    item.merchantName,
    item.idInSite,
    item.sourceUrl
  );

  const itemUrl = `https://www.acties.nl/${item.merchantName}#coupon-${item.idInSite}`;

  return { generatedHash, hasCode: item.hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  await page.setJavaScriptEnabled(true);

  try {
    const currentItems = [
      ...(await page.$$('section.active article')),
      ...(await page.$$('section.related-offers article')),
    ];
    const expiredItems = await page.$$('section.expired article');

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

    const merchantName = await page.evaluate(() =>
      document.querySelector('#store-topbar img')?.getAttribute('title')
    );

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantUrl = await page.evaluate(() => {
      const fullPath = document.querySelector('#store-topbar .link span')
        ?.textContent;

      return `https://${fullPath}`;
    });

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning(`Merchant Domain not found for ${request.url}`);

    const itemsWithCode: ItemResult[] = [];

    for (const item of items) {
      const title = await page.evaluate((node) => {
        return node?.querySelector('h3')?.textContent;
      }, item);

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }

      const idInSite = await page.evaluate((node) => {
        return node?.getAttribute('data-offer-id');
      }, item);

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const hasCode = await page.evaluate((node) => {
        return !!node?.querySelector('.code');
      }, item);

      const isExpired = await page.evaluate((node) => {
        return node?.parentElement?.className.includes('expired');
      }, item);

      const description = await page.evaluate((node) => {
        return node?.querySelector('.offer-info .details')?.textContent?.trim();
      }, item);

      const termsAndConditions = await page.evaluate(
        (node) => node?.querySelector('.offer-info .terms')?.textContent,
        item
      );

      const isExclusive = await page.evaluate(
        (node) =>
          node
            ?.querySelector('.details .coupon-tag')
            ?.textContent?.includes('Exclusieve'),
        item
      );

      const itemData = {
        title,
        idInSite,
        merchantDomain,
        merchantName,
        hasCode,
        isExpired,
        description,
        isExclusive,
        termsAndConditions,
        sourceUrl: request.url,
      };

      const result: ItemResult = processItem(itemData);

      if (!result.hasCode) {
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
        continue;
      }
      itemsWithCode.push(result);
    }

    for (const item of itemsWithCode) {
      await sleep(100);
      if (!item.itemUrl) continue;

      await enqueueLinks({
        urls: [item.itemUrl],
        userData: {
          ...request.userData,
          label: Label.getCode,
          validatorData: item.validator.getData(),
        },
      });
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

// TODO: Implement the handler for the getCode label if needed
router.addHandler(Label.getCode, async (context) => {
  // Destructure objects from the context
  const { request, page, log } = context;

  try {
    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);

    await page.waitForSelector('#popup');
    // Get the code value from the JSON response
    const code = await page.evaluate(() => {
      return document
        .querySelector('#popup .code-box .copy-code')
        ?.getAttribute('data-clipboard-text');
    });

    if (!code) {
      log.warning('No code found');
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
