import { createCheerioRouter } from 'crawlee';
import { logger } from 'shared/logger';
import { Label } from 'shared/actor-utils';
import { formatDateTime } from 'shared/helpers';
import { DataValidator } from 'shared/data-validator';
import { postProcess, preProcess } from 'shared/hooks';

export const router = createCheerioRouter();

const HEADER = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  priority: 'u=1, i',
  referer: 'https://www.bravovoucher.co.uk/discount-code-autodoc.html',
  'sec-ch-ua':
    '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent':
    'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SQ3A.220705.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/407.0.0.0.65;]',
};
function processItem(item: any) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('description', item.description);
  validator.addValue('idInSite', item.idInSite);

  // Add optional values to the validator
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('description', item.description);
  validator.addValue('expiryDateAt', formatDateTime(item.expiryDateAt));
  validator.addValue('isExclusive', item.exclusiveVoucher);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  return { hasCode: item.hasCode, itemUrl: item.url, validator };
}

function tripleBase64Encode(input: string): string {
  return Buffer.from(
    Buffer.from(Buffer.from(input).toString('base64')).toString('base64')
  ).toString('base64');
}

// Function to generate the link
function generateLink(
  element: any
): { itemUrl: string; token: string; activeUrl: string } {
  let popupType = '';
  let url = '';
  let dealId = '';

  const attributes = element.attr();

  // Iterate over attributes to construct URL
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== 'string') continue;
    switch (key) {
      case 'data-popup':
        popupType =
          value === 'm' || value === 'l'
            ? value
            : Buffer.from(value, 'base64').toString('utf-8');
        break;
      case 'data-out':
        url = Buffer.from(value, 'base64').toString('utf-8');
        // eslint-disable-next-line no-case-declarations
        const dealIdMatch = url.match(/\/deal\/(\d+)\.html/);
        dealId = dealIdMatch ? dealIdMatch[1] : '';
        break;
      case 'data-lst':
        url += `&l=${value}`;
        break;
      case 'data-sku':
        url += `&s=${value}`;
        break;
      case 'data-pos':
        url += `&p=${value}`;
        break;
    }
  }

  // Generate a unique tracking ID
  const trackingId = `${Date.now()}-${Math.random()
    .toString(36)
    .substring(3, 7)}0`;

  // Append tracking information based on popup type
  switch (popupType) {
    case 'm':
      url += `&track=${trackingId}`;
      break;
    case 'l':
      // No additional processing needed
      break;
    default:
      popupType += `#${trackingId}`;
      url += `&track=${trackingId}`;
  }

  const urlParams = new URLSearchParams(url.split('?')[1]);

  const track = urlParams.get('track') || '';
  const t = urlParams.get('t') || '';

  // Construct the new URL
  const itemUrl = `deal.html?d=${dealId}&track=${track}&t=${t}`;
  const token = tripleBase64Encode(t);
  const activeUrl = `deal/${dealId}.html?t=${t}&track=${track}`;

  return { itemUrl, token, activeUrl };
}

router.addHandler(Label.listing, async (context) => {
  const { request, $, log, enqueueLinks } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Listing ${request.url}`);

    // Retry if the page has a captcha
    if ($('div.g-recaptcha').length) {
      logger.warning(`Recaptcha found in sourceUrl ${request.url}`);
      throw new Error(`Recaptcha found in sourceUrl ${request.url}`);
    }

    const merchantName = $('#merchant-rating img').attr('alt')?.toLowerCase();

    if (!merchantName) {
      throw new Error('Merchant name not found');
    }

    // deals div has attribute data-deal-offer
    const items = $('div[data-deal-offer], div[data-deal-code]')
      .map((_, el) => {
        const button = $(el).find('div[data-out]').first();
        const idInSite = button.attr('data-sku');
        const lst = button.attr('data-lst');
        const pos = button.attr('data-pos');
        const { itemUrl, token, activeUrl } = generateLink(button);

        const link = new URL(itemUrl, request.url).href;

        const connectUrl = new URL(
          `${activeUrl}&s=${idInSite}&p=${pos}&l=${lst}`,
          request.url
        ).href;

        const expiryContent = $(el).find('.pt-1').text();
        const expiringDateMatch = expiryContent.match(
          /(\d{1,2}\/\d{1,2}\/\d{4})/
        );
        const expiryDateAt = expiringDateMatch
          ? new Date(expiringDateMatch[1]).toISOString()
          : '';

        return {
          title: $(el).find('h3')?.text(),
          description: $(el).find('.description')?.text(),
          idInSite,
          itemUrl: link,
          connectUrl,
          token,
          isExclusive: $(el).attr('data-deal-exclusive') !== undefined,
          isExpired: false,
          hasCode: $(el).attr('data-deal-code') !== undefined,
          merchantName,
          sourceUrl: request.url,
          expiryDateAt,
        };
      })
      .get();

    try {
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            items,
          },
          // IndexPageHandler: {
          //   indexPageSelectors: request.userData.pageSelectors,
          // },
        },
        context
      );
    } catch (error) {
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    for (const item of items) {
      const { validator } = processItem(item);

      if (item.hasCode) {
        if (!item.itemUrl) continue;

        await enqueueLinks({
          label: Label.details,
          urls: [item.connectUrl],
          forefront: true,
          userData: {
            ...request.userData,
            codeUrl: item.itemUrl,
            token: item.token,
            validatorData: validator.getData(),
          },
          transformRequestFunction: (req) => {
            req.keepUrlFragment = true;
            req.headers = {
              ...request.headers,
              ...HEADER,
            };
            return req;
          },
        });

        continue;
      }

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator: validator,
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

router.addHandler(Label.details, async (context) => {
  const { request, $, log, enqueueLinks } = context;

  try {
    log.info(`Details ${request.url}`);

    // Retry if the page has a captcha
    if ($('div.g-recaptcha').length) {
      logger.warning(`Recaptcha found in sourceUrl ${request.url}`);
      throw new Error(`Recaptcha found in sourceUrl ${request.url}`);
    }

    await enqueueLinks({
      label: Label.getCode,
      urls: [request.userData.codeUrl],
      forefront: true,
      userData: {
        ...request.userData,
      },
      transformRequestFunction: (req) => {
        req.keepUrlFragment = true;
        req.headers = {
          ...request.headers,
          'x-cache-ray': request.userData.token,
        };
        return req;
      },
    });
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  const { request, $, log } = context;

  try {
    log.info(`GetCode ${request.url}`);

    // Retry if the page has a captcha
    if ($('div.g-recaptcha').length) {
      logger.warning(`Recaptcha found in sourceUrl ${request.url}`);
      throw new Error(`Recaptcha found in sourceUrl ${request.url}`);
    }

    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const code = $('#offerCodeToCopy')?.val()?.trim() || null;

    if (!code || code.length > 20) {
      logger.warning(`Code not found in sourceUrl ${request.url}`);
      return;
    }

    log.info(`Code: ${code}`);

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
