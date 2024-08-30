import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { generateItemId } from 'shared/helpers';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, log } = context;

  if (request.userData.label !== Label.listing) return;

  const processItem = async (item: any) => {
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

    const generatedHash = generateItemId(
      item.merchantName,
      item.idInSite,
      item.sourceUrl
    );

    return { generatedHash, hasCode, validator };
  };

  try {
    log.info(`Listing ${request.url}`);

    // Retry if the page has a captcha
    if ($('div.g-recaptcha').length) {
      logger.warning(`Recaptcha found in sourceUrl ${request.url}`);
      throw new Error(`Recaptcha found in sourceUrl ${request.url}`);
    }

    const merchantName = $('#merchant-rating img').attr('alt')?.toLowerCase();

    if (!merchantName) {
      logger.error(`Not merchantName found in sourceUrl ${request.url}`);
      return;
    }

    // deals div has attribute data-deal-offer
    const items = $('div[data-deal-offer]');

    try {
      // Preprocess the data
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            items: items?.toArray(),
          },
        },
        context
      );
    } catch (error) {
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    // Initialize variables
    let processedData: any = {};

    for (const item of items) {
      const title = $(item).find('.h3')?.text();

      if (!title) {
        logger.error(`Title not found in item ${request.url}`);
        continue;
      }

      const description = $(item).find('.description')?.text()?.trim();

      const idInSite = $(item)
        .find('div[data-code]')
        .attr('data-sku')
        ?.split('-')?.[1];

      if (!idInSite) {
        logger.error('IdInSite not found in item');
        continue;
      }

      const code = $(item).find('div[data-code]')?.attr('data-code');

      processedData = await processItem({
        idInSite,
        title,
        description,
        merchantName,
        code,
        sourceUrl: request.url,
      });

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
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
