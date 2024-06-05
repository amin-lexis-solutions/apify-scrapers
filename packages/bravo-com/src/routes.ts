import { createCheerioRouter } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  CouponHashMap,
  CouponItemResult,
  checkCouponIds,
  generateCouponId,
  logError,
} from 'shared/helpers';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;

  if (request.userData.label !== Label.listing) return;

  const processCouponItem = async (item) => {
    // Create a new DataValidator instance
    const validator = new DataValidator();

    // Add required values to the validator
    validator.addValue('sourceUrl', item.sourceUrl);
    validator.addValue('merchantName', item.merchantName);
    validator.addValue('title', item.title);
    validator.addValue('description', item.description);
    validator.addValue('idInSite', item.idInSite);

    // Add optional values to the validator
    validator.addValue('isShown', true);

    const hasCode = !!item.code;

    if (hasCode) validator.addValue('code', item.code);

    const generatedHash = generateCouponId(
      item.merchantName,
      item.idInSite,
      item.sourceUrl
    );

    return { generatedHash, hasCode, validator };
  };

  try {
    log.info(`Listing ${request.url}`);

    const merchantName = $('#merchant-rating img').attr('alt')?.toLowerCase();

    if (!merchantName) {
      logError(`Not merchantName found in sourceUrl ${request.url}`);
      return;
    }

    const items = $('#deals div')?.toArray();

    try {
      // Preprocess the data
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            coupons: items,
          },
        },
        context
      );
    } catch (error) {
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    // Initialize variables
    const couponsWithCode: CouponHashMap = {};
    const idsToCheck: string[] = [];
    let processedData: any = {};

    for (const item of items) {
      const title = $(item).find('.h3')?.text();

      if (!title) {
        logError('title not found in item');
        continue;
      }

      const description = $(item).find('.description')?.text()?.trim();

      const idInSite = $(item)
        .find('div[data-code]')
        .attr('data-sku')
        ?.split('-')?.[1];

      if (!idInSite) {
        logError('IdInSite not found in item');
        continue;
      }

      const code = $(item).find('div[data-code]')?.attr('data-code');

      processedData = await processCouponItem({
        idInSite,
        title,
        description,
        merchantName,
        code,
        sourceUrl: request.url,
      });

      if (processedData.hasCode) {
        couponsWithCode[processedData.generatedHash] = processedData;
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
    const nonExistingIds = await checkCouponIds(idsToCheck);
    // If non-existing coupons are found, process and store their data
    if (nonExistingIds.length == 0) return;

    let currentResult: CouponItemResult;
    // Loop through each nonExistingIds and process it
    for (const id of nonExistingIds) {
      currentResult = couponsWithCode[id];
      await postProcess(
        {
          SaveDataHandler: {
            validator: currentResult.validator,
          },
        },
        context
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
