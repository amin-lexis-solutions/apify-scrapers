import { logger } from 'shared/logger';
import cheerio from 'cheerio';
import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  getMerchantDomainFromUrl,
  ItemResult,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function processItem(item: any, $cheerio: cheerio.Root) {
  let startDateAt = '';
  let expiryDateAt = '';

  const startDateAttr = $cheerio
    .root()
    .children()
    .first()
    .attr('data-start_date');
  if (startDateAttr && startDateAttr.trim()) {
    startDateAt = formatDateTime(startDateAttr);
  }

  const expiryDateAttr = $cheerio
    .root()
    .children()
    .first()
    .attr('data-end_date');
  if (expiryDateAttr && expiryDateAttr.trim()) {
    expiryDateAt = formatDateTime(expiryDateAttr);
  }

  const code = $cheerio('.couponCode').text();

  // Extract the description
  let description = '';
  const descElement = $cheerio('div.vouchdescription > ul').first();
  if (descElement.length > 0) {
    description = he
      .decode(descElement.text())
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);

  validator.addValue('title', item.title);
  validator.addValue('description', description);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('expiryDateAt', expiryDateAt);
  validator.addValue('startDateAt', startDateAt);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const hasCode = !!code;

  hasCode ? validator.addValue('code', code) : null;

  return { hasCode, validator, itemUrl: '' };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    // Extract valid coupons
    const items = $('div.rect_shape > div.company_vocuher');

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

    const merchantNameEncoded = $('div.Breadcrumb > div.container_center')
      .contents()
      .filter((i, element) => {
        // element.type === 'text' ensures the node is a text node
        // $.trim($(element).text()) checks if the text is non-empty when trimmed
        return element.type === 'text' && $(element).text().trim() !== '';
      })
      .first()
      .text()
      .trim();

    const merchantName = he.decode(merchantNameEncoded);

    if (!merchantName) {
      logger.error(`Merchant name not found ${request.url}`);
      return;
    }

    const merchantUrl = $('.icon_globe a')?.attr('href');

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;

    if (!merchantDomain) {
      log.warning('merchantDomain name is missing');
    }

    let result: ItemResult;

    for (const item of items) {
      const $cheerioElement = cheerio.load(item);
      // Extract the voucher title
      const title = $cheerioElement('h3')?.first()?.text()?.trim();

      if (!title) {
        logger.error('title not found in item');
        continue;
      }

      const idInSite = $cheerioElement('h3')
        .attr('data-rel')
        ?.match(/\d+$/)?.[0];

      if (!idInSite) {
        logger.error('idInSite not found in item');
        continue;
      }

      const itemData = {
        title,
        idInSite,
        merchantName,
        merchantDomain,
        sourceUrl: request.url,
      };

      result = await processItem(itemData, $cheerioElement);

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
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
