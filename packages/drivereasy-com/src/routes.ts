/* eslint-disable no-inner-declarations */
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { getMerchantDomainFromUrl, formatDateTime } from 'shared/helpers';
import { Label, CUSTOM_HEADERS } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import jp from 'jsonpath';

// Export the router function that determines which handler to use based on the request label
export const router = createCheerioRouter();

function processItem(merchantName, merchantDomain, voucher, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucher.title);
  validator.addValue('idInSite', voucher.idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', voucher.description);
  validator.addValue('termsAndConditions', voucher.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
  validator.addValue('startDateAt', formatDateTime(voucher.startTime));
  validator.addValue('isExclusive', voucher.exclusiveVoucher);
  validator.addValue('isExpired', voucher.isExpired);
  validator.addValue('isShown', true);

  const hasCode = voucher?.type === 'code';

  const itemUrl = `${sourceUrl}?promoid=${voucher.idInSite}`;

  return { hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;
  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    log.info(`Listing ${request.url}`);

    const scriptContent =
      $('script[type="application/ld+json"]').text() || '{}';

    const jsonData = JSON.parse(scriptContent) || {};

    const merchantDomain = getMerchantDomainFromUrl(request.url);
    const merchantName =
      jp.query(jsonData, '$..mainEntity.name')[0] ||
      $('.breadcrumbs a:last-child').text().trim() ||
      null;

    if (!merchantName) {
      logger.error(`MerchantName not found ${request.url}`);
      log.error(scriptContent);
      return;
    }

    log.info(`MerchantName: ${merchantName}`);

    const items: any[] =
      $('.list_coupons li .offer_card')
        .map((_, el) => {
          const $el = $(el);
          return {
            title: $el.find('.title').text().trim() || null,
            idInSite: $el.find('a.go_crd').attr('data-cid') || null,
            description: $el.find('.promo_infor').text().trim() || null,
            termsAndConditions:
              $el.find('.details-terms-box').text().trim() || null,
            startTime: null,
            endTime:
              $el.find('.time_success li:first-child').text().trim() || null,
            exclusiveVoucher: $el.find('.oexclusive').length > 0,
            isExpired: $el.hasClass('detail_filter_expired'),
            isVerified: $el.find('.exclusive_label').length > 0,
            type: $el.hasClass('detail_filter_code') ? 'code' : 'deal',
          };
        })
        .get() || [];

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

    for (const item of items) {
      if (!item?.title || !item?.idInSite) {
        logger.info('Title not found');
        continue;
      }

      const result = processItem(
        merchantName,
        merchantDomain,
        item,
        request.url
      );

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        await crawler.requestQueue.addRequest(
          {
            url: result.itemUrl,
            userData: {
              ...request.userData,
              label: Label.getCode,
              validatorData: result.validator.getData(),
            },
            headers: CUSTOM_HEADERS,
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
        logger.error(`Post-Processing Error : ${error.message}`, error);
        return;
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  const { request, $, log } = context;

  try {
    log.info(`Getting code for ${request.url}`);
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Extract the code from the page
    const NodeSuffix = 'p';
    function getClassPart(elementId: string): string | null {
      const element = $(`#${elementId}`);
      if (element.length) {
        const match = element.attr('class')?.match(/\s*xxh_(\S+)/);
        return match ? match[1] : null;
      }
      return null;
    }
    const part1 = getClassPart('f' + NodeSuffix);
    const part2 = getClassPart('s' + NodeSuffix);
    const part3 = getClassPart('t' + NodeSuffix);
    let code: string | null = null;
    if (part1 && part2 && part3) {
      const completestr = part1 + part2 + part3;
      const decodedStr1 = decodeURIComponent(
        Buffer.from(completestr, 'base64').toString('binary')
      );
      const decodedStr2 = decodeURIComponent(
        Buffer.from(decodedStr1, 'base64').toString('binary')
      );
      code = decodedStr2;
    }

    if (!code) {
      log.warning('No code found');
    }
    log.info(`Code: [${code}]`);
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
  } catch (error) {
    log.error(`Error in getCode handler: ${error}`);
  }
});
