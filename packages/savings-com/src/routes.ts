import { createPuppeteerRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  formatDateTime,
  getMerchantDomainFromUrl,
  ItemResult,
} from 'shared/helpers';

import { preProcess, postProcess } from 'shared/hooks';
//TODO: Actor To Investigate later
// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

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
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  item?.hasCode && validator.addValue('code', item.code);

  const itemUrl = `${item.sourceUrl}#d-${item.idInSite}`;

  return { hasCode: item?.hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const items = await page.$$('.list-deals div.module-deal');

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
      return document?.querySelector('.breadcrumb')?.lastElementChild
        ?.textContent;
    });

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantDomain = getMerchantDomainFromUrl(request.url);

    merchantDomain
      ? log.info(`Merchant Name: ${merchantName} - Domain: ${merchantDomain}`)
      : log.warning('merchantDomain not found');

    for (const itemHandle of items) {
      const title = await itemHandle.evaluate((node) => {
        return node.querySelector('p.title-wrap')?.textContent;
      });

      if (!title) {
        logger.error('Coupon title not found in item');
        continue;
      }
      const idInSite = await itemHandle.evaluate((node) => {
        return node?.getAttribute('id')?.replace('d-', '');
      });

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const itemBtn = await itemHandle.$('.details-toggle');
      await itemBtn?.click(); // toggle details

      const description = await itemHandle.evaluate((node) => {
        return node.querySelector('.details p')?.textContent;
      });

      const hasCode = await itemHandle.evaluate((node) => {
        return node
          .querySelector('.action button span')
          ?.textContent?.includes('Get Code');
      });

      const code = await itemHandle.evaluate((node) => {
        const endCode = node
          .querySelector('input[name=property-code-partial]')
          ?.getAttribute('value');

        const startCode = node.querySelector('.code')?.textContent;

        return `${startCode}${endCode}`;
      });

      const itemData = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
        description,
        hasCode,
        code,
        sourceUrl: request.url,
      };
      const result: ItemResult = processItem(itemData);

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
