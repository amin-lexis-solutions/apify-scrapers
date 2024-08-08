import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { ElementHandle } from 'puppeteer';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import {
  ItemHashMap,
  ItemResult,
  checkItemsIds,
  generateHash,
} from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';

export const router = Router.create<PuppeteerCrawlingContext>();

async function process(
  item: any,
  element: ElementHandle<HTMLElement>
): Promise<ItemResult> {
  const desc = await element.$eval(`.offer p`, (node) => node.textContent);

  const codeElement = await element.$('strong');

  const code = codeElement
    ? await codeElement.evaluate((node) => node.textContent)
    : null;

  const hasCode = !!code;

  const validator = new DataValidator();

  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('code', code);
  validator.addValue('description', desc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateHash(
    item.merchantName,
    item.title,
    item.sourceUrl
  );

  return { generatedHash, validator, hasCode, itemUrl: '' };
}
router.addHandler(Label.listing, async (context) => {
  const { request, page, log } = context;

  log.info(`Listing ${request.url}`);

  const items = await page.$$('article');

  // pre-pressing hooks here to avoid unnecessary requests
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
    log.warning(`Pre-Processing Error : ${error.message}`);
    return;
  }

  const merchantElement = await page.$('.sle img');

  const merchantName = await merchantElement?.evaluate(
    (img) => img.getAttribute('alt')?.split('.')?.[0]
  );

  if (!merchantName) {
    logger.error('merchantName not found');
    return;
  }

  const merchantDomain = await merchantElement?.evaluate((img) =>
    img.getAttribute('alt')?.toLowerCase()
  );

  if (!merchantDomain) {
    log.info(`Domain not found ${request.url}`);
  }

  // Initialize variables
  const itemsWithCode: ItemHashMap = {};
  const idsToCheck: string[] = [];
  let processedData: any = {};

  // Loop through each element and process it
  for (const itemHandle of items) {
    const idInSite = await itemHandle.evaluate((node) =>
      node.getAttribute(`id`)
    );

    if (!idInSite) {
      logger.error(`idInSite not found in item`);
      continue;
    }
    const title = await itemHandle.$eval(
      `.offer h2`,
      (node) => node.textContent
    );

    if (!title) {
      logger.error(`Domtitleain not found in item`);
      continue;
    }

    const itemData = {
      title,
      idInSite,
      merchantName,
      merchantDomain,
      sourceUrl: request.url,
    };
    processedData = await process(itemData, itemHandle);

    // If coupon has no code, process and store its data
    if (processedData.hasCode) {
      itemsWithCode[processedData.generatedHash] = processedData;
      idsToCheck.push(processedData.generatedHash);
      continue;
    }

    try {
      await postProcess(
        {
          SaveDataHandler: {
            validator: processedData.validator,
          },
        },
        context
      );
    } catch (error: any) {
      log.warning(`Post-Processing Error : ${error.message}`);
      return;
    }
  }
  // Call the API to check if the coupon exists
  const nonExistingIds = await checkItemsIds(idsToCheck);
  // If non-existing coupons are found, process and store their data
  if (nonExistingIds.length == 0) return;

  let currentResult: ItemResult;
  // Loop through each nonExistingIds and process it
  for (const id of nonExistingIds) {
    currentResult = itemsWithCode[id];
    await postProcess(
      {
        SaveDataHandler: {
          validator: currentResult.validator,
        },
      },
      context
    );
  }
});
