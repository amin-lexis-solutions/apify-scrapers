import { createCheerioRouter, log } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { formatDateTime, ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

function processItem(item: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('description', item.description);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.expiringDate));
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  // url is host form sourceUrl + item.showCodeUrl
  const parsedUrl = new URL(item.sourceUrl);
  const itemUrl = `https://${parsedUrl.host}${item.showCodeUrl}`;

  return { hasCode: item.hasCode, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, enqueueLinks, log } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const merchantName =
      $('.header-shop-logo').attr('alt')?.trim() ||
      $('.meta[itemprop="name"]').attr('content')?.trim() ||
      null;

    if (!merchantName) {
      logger.error('Unable to find merchant name');
      return;
    }
    const merchantDomain = $('.shop-link')?.text()?.trim() || null;

    const items: any =
      $('.card-offer-shop')
        .map((_, el) => {
          const $el = $(el);
          const description =
            $el
              .find('.shop-offer-desc p')
              .not('p:has(span.conditions)')
              .map((_, el) => $(el).text())
              .get()
              .join(' ') || '';

          const termsAndConditions =
            $el
              .find('.shop-offer-desc p:has(span.conditions)')
              .map((_, el) => $(el).text())
              .get()
              .join(' ') || '';

          const expiringDateMatch = termsAndConditions.match(
            / (\d{1,2} \w+ \d{4})/
          );
          const expiringDate = expiringDateMatch
            ? new Date(expiringDateMatch[1])?.toDateString()
            : '';

          const dataRedir =
            $el.find('.card-title span').attr('data-redir') || '';
          const showCodeUrl = dataRedir
            ? Buffer.from(dataRedir, 'base64').toString('utf-8')
            : null;

          return {
            sourceUrl: request.url,
            merchantName,
            merchantDomain,
            title: $el.find('.card-title').text().trim(),
            description: description,
            termsAndConditions: termsAndConditions,
            expiringDate: expiringDate,
            idInSite: $el.find('.card-title span').attr('data-id') || '',
            isExclusive: $el.find('.badge.exclu-offer').length > 0,
            isExpired: $el.hasClass('offer-exp'),
            hasCode: !!showCodeUrl,
            showCodeUrl,
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

    let result: ItemResult;

    logger.info(
      `MerchantName ${merchantName} : domain  ${merchantDomain}` +
        ` \n items found: ${items.length}`
    );
    for (const item of items) {
      if (!item.idInSite) {
        logger.error(`not idInSite found in item`);
        continue;
      }

      if (!item.title) {
        logger.error(`not title found in item`);
        continue;
      }

      result = processItem(item);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        await enqueueLinks({
          urls: [result.itemUrl],
          userData: {
            ...request.userData,
            label: Label.details,
            validatorData: result.validator.getData(),
          },
          forefront: true,
          transformRequestFunction: (request) => {
            request.keepUrlFragment = true;
            return request;
          },
        });
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
        log.warning(`Post-Processing Error : ${error.message}`);
        return;
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.details, async (context) => {
  const { request, enqueueLinks } = context;

  if (request.userData.label !== Label.details) return;

  try {
    // Extracting request and body from context
    const existingCookies = context.session?.getCookieString(request.url) || '';
    // Create new jc- cookies
    const newCookies = existingCookies
      ?.split(';')
      .map((cookie) => cookie.trim())
      .filter((cookie) => cookie.startsWith('c-'))
      .map((cookie) => {
        const [name, value] = cookie.split('=');
        return `jc-${name.split('-')[1]}=${value}`;
      });

    const allCookies = [...existingCookies.split(';'), ...newCookies].join(
      '; '
    );
    await enqueueLinks({
      urls: [request.url],
      userData: {
        ...request.userData,
        label: Label.getCode,
      },
      forefront: true,
      transformRequestFunction: (request) => {
        request.keepUrlFragment = true;
        request.useExtendedUniqueKey = true;
        request.headers = {
          ...request.headers,
          Cookie: allCookies,
        };
        return request;
      },
    });
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, $ } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const code = $('#code').val() || null;

    if (code) validator.addValue('code', code);
    log.info(`${request.url} \n Found code: ${code}`);

    // Process and store the data

    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
