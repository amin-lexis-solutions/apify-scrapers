import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import cheerio from 'cheerio';

import { DataValidator } from 'shared/data-validator';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();
// TODO: Review this actor
router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }
  try {
    // Find all valid coupons on the page
    const items = $('#codes .offer-item');

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            items,
          },
        },
        context
      );
    } catch (error: any) {
      logger.error(`Pre-Processing Error : ${error.message}`, error);
      return;
    }

    // Iterate over each coupon to extract url
    for (const item of items) {
      const id = $(item).attr('data-cid');

      if (!id) {
        logger.error(`idInsite not found in item`);
        continue;
      }
      // Construct item URL
      const itemUrl = `${request.url}?show=${id}`;

      await crawler.requestQueue.addRequest(
        {
          url: itemUrl,
          userData: {
            ...request.userData,
            label: Label.details,
            id: id,
          },
          headers: CUSTOM_HEADERS,
        },
        { forefront: true }
      );
    }
  } finally {
    // We don't catch errors explicitly so that they are logged in Sentry,
    // but we use finally to ensure proper cleanup and termination of the actor.
  }
});

router.addHandler(Label.details, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.details) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  const items = $('#codes .offer-item');

  // Extract domain from the request URL
  const merchantDomain = $('.shop-link.go span')?.text();

  if (!merchantDomain) {
    log.warning(`merchantDomain not found`);
  }

  const merchantName: any = $('.img-holder a img')?.attr('alt');

  if (!merchantName) {
    logger.error(`merchantName not found ${request.url}`);
    return;
  }

  for (const item of items) {
    const $cheerio = cheerio.load(item);
    const title = $cheerio('.-offer-title .code-link-popup')
      ?.text()
      ?.trim()
      ?.split('Discount')?.[0];

    if (!title) {
      logger.error(`title not found in item`);
      continue;
    }
    const desc = $cheerio('.-description')?.text()?.trim();
    const idInSite = $cheerio('*')?.attr('data-cid');

    if (!idInSite) {
      logger.error(`idInSite not found in item`);
      continue;
    }

    const code = $cheerio('.-code-container')?.attr('data-clipboard-text');

    // Create a DataValidator instance and populate it with coupon data
    const validator = new DataValidator();

    validator.addValue('domain', merchantDomain);
    validator.addValue('sourceUrl', request.url);
    validator.addValue('merchantName', merchantName);
    validator.addValue('title', title);
    validator.addValue('code', code);
    validator.addValue('idInSite', idInSite);
    validator.addValue('description', desc);
    validator.addValue('isExpired', false);
    validator.addValue('isShown', true);

    try {
      await postProcess(
        {
          SaveDataHandler: {
            validator: validator,
          },
        },
        context
      );
    } catch (error: any) {
      logger.error(`Post-Processing Error : ${error.message}`, error);
      return;
    }
  }
});
