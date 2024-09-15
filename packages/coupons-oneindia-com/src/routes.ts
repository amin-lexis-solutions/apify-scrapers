import { createPuppeteerRouter } from 'crawlee';
import { logger } from 'shared/logger';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  ItemResult,
  formatDateTime,
  getMerchantDomainFromUrl,
} from 'shared/helpers';
import { postProcess, preProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processItem(item): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = item?.idPool?.replace('in_', '');

  // Add required values to the validator
  validator.addValue('sourceUrl', item.sourceUrl);
  validator.addValue('merchantName', item.merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', item?.merchantDomain);
  validator.addValue('description', item?.description);
  validator.addValue('termsAndConditions', item?.termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item?.endTime));
  validator.addValue('startDateAt', formatDateTime(item?.startTime));
  validator.addValue('isExclusive', item?.exclusiveVoucher);
  validator.addValue('isExpired', item?.isExpired);
  validator.addValue('isShown', true);

  const hasCode = item?.type.includes('code');

  const itemUrl = `https://coupons.oneindia.com/api/voucher/country/in/client/${item?.retailerId}/id/${item?.idPool}`;

  return { hasCode, itemUrl, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, enqueueLinks, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    const nextDataElement = await page.$eval(
      'script[id="__NEXT_DATA__"]',
      (script) => script?.textContent
    );

    if (!nextDataElement) {
      logger.error(`nextData element no found in url`);
      return;
    }

    const nextData = JSON.parse(nextDataElement);

    if (!nextData || !nextData?.props) {
      logger.error(`nextData props no found in ${request.url}`);
      return;
    }

    const retailerId = nextData?.query?.clientId;
    const pageProps = nextData?.props?.pageProps;

    // Declarations outside the loop
    const merchantName = pageProps?.retailer?.name;

    if (!merchantName) {
      logger.error(`merchantName not found JSON nextData - ${request.url}`);
      return;
    }

    const merchantUrl = pageProps?.retailer?.merchant_url;

    if (!merchantUrl) {
      log.warning(`merchantDomainUrl not found ${request.url}`);
    }

    const merchantDomain = merchantUrl
      ? getMerchantDomainFromUrl(merchantUrl)
      : null;
    // Combine active and expired vouchers
    const currentItems = pageProps.vouchers.map((voucher) => ({
      ...voucher,
      is_expired: false,
    }));

    const expiredItems = pageProps.expiredVouchers.map((voucher) => ({
      ...voucher,
      is_expired: true,
    }));

    const items = [...currentItems, ...expiredItems];

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

    for (const item of items) {
      if (!item.idPool) {
        logger.error(`idInSite no found in item`);
        continue;
      }

      if (!item.title) {
        logger.error(`title no found in item`);
        continue;
      }

      const itemData = {
        merchantName,
        merchantDomain,
        retailerId,
        sourceUrl: request.url,
        ...item,
      };

      result = processItem(itemData);

      if (result.hasCode) {
        if (!result.itemUrl) continue;
        await enqueueLinks({
          urls: [result.itemUrl],
          userData: {
            ...request.userData,
            label: Label.getCode,
            validatorData: result.validator.getData(),
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
  // Destructure objects from the context
  const { request, page, log } = context;

  try {
    log.info(`GetCode ${request.url}`);
    // Extract validator data from request's user data
    const validatorData = request.userData.validatorData;
    // Create a new DataValidator instance
    const validator = new DataValidator();
    // Load validator data
    validator.loadData(validatorData);
    // Get the HTML content of the page
    const htmlContent = await page.content();
    // Match the pattern "code":"..." in the HTML content
    const match = htmlContent.match(/"code":"([^"]+)"/);
    // If no match is found, exit
    if (match?.length == 0) return;
    // Add the matched code value to the validator
    validator.addValue('code', match?.[1]);
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
