import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { logger } from 'shared/logger';
import { formatDateTime, ItemResult } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';
import jp from 'jsonpath';

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

function processItem(item: any): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();
  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('domain', item.merchantDomain);
  validator.addValue('termsAndConditions', item.termsAndConditions);
  validator.addValue('title', item?.title);
  validator.addValue('idInSite', item?.idInSite);
  validator.addValue('code', item?.code);
  validator.addValue(
    'expiryDateAt',
    item?.expiryDateAt ? formatDateTime(item.expiryDateAt) : null
  );
  validator.addValue(
    'startDateAt',
    item?.startDateAt ? formatDateTime(item.startDateAt) : null
  );
  validator.addValue('isExclusive', item?.isExclusive ?? false);
  validator.addValue('isShown', true);

  return { hasCode: true, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, log, $, enqueueLinks } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Listing ${request.url}`);

    const graphSchema = $('script[id="schema-org-graph"]').html() || '{}';

    const graphData = JSON.parse(graphSchema) || null;

    if (!graphData) {
      logger.error('Graph data not found');
      return;
    }

    const items = $('main.grow  .block.cursor-pointer');

    // extract slug from  request.url
    const slug = request.url.split('/').pop();

    if (!slug) {
      logger.error(`Slug not found in URL: ${request.url}`);
      return;
    }

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

    const detailsUrl = `https://www.sparwelt.de/api/pages/shop?slug=${slug}`;

    await enqueueLinks({
      urls: [detailsUrl],
      userData: {
        ...request.userData,
        label: Label.details,
        sourceUrl: request.url,
      },
      forefront: true,
    });
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.details, async (context) => {
  const { request, body, log } = context;

  if (request.userData.label !== Label.details) return;

  try {
    log.info(`Processing URL: ${request.url}`);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Safely parse the JSON string
    const voucherJson = JSON.parse(htmlContent);

    // Validate the necessary data is present
    if (!voucherJson || !voucherJson.shop || !voucherJson.vouchers) {
      logger.error('Voucher data not found');
      return;
    }

    const merchantName = jp.query(voucherJson, '$.shop.title')[0];
    const domainUrl = jp.query(voucherJson, '$.shop.domainUrl')[0];

    const domainName = new URL(domainUrl).hostname || '';

    const vouchers = jp.query(voucherJson, '$.vouchers')?.[0] || [];
    const voucherExpired =
      jp.query(voucherJson, '$.vouchersExpired')?.[0] || [];

    const items = [...vouchers, ...voucherExpired]
      .map((voucher: any) => {
        return {
          merchantName: merchantName,
          merchantDomain: domainName,
          sourceUrl: request.userData.sourceUrl,
          title: voucher.title || null,
          termsAndConditions: jp.query(voucher, '$..product')[0] || null,
          idInSite: voucher.id || null,
          code: voucher.code?.type === 'single' ? voucher.code.code : null,
          expiryDateAt: jp.query(voucher, '$.expiryDate')[0] || null,
          isExclusive: voucher.exclusive || false,
          startDateAt: jp.query(voucher, '$..AvailableFrom')[0] || null,
          expiryDate: jp.query(voucher, '$..AvailableTill')[0] || null,
        };
      })
      .filter((item: any) => item.title && item.idInSite);

    for (const item of items) {
      const { validator } = processItem(item);

      await postProcess(
        {
          SaveDataHandler: {
            validator: validator,
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

export { router };
