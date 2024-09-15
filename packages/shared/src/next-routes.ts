import { createCheerioRouter } from 'crawlee';
import { DataValidator } from './data-validator';
import { logger } from 'shared/logger';
import {
  sleep,
  getMerchantDomainFromUrl,
  ItemResult,
  formatDateTime,
} from './helpers';
import { preProcess, postProcess } from './hooks';
import { Label, CUSTOM_HEADERS } from './actor-utils';
import jp from 'jsonpath';

function checkVoucherCode(code: string | null | undefined) {
  // Trim the code to remove any leading/trailing whitespace
  const trimmedCode = code?.trim();

  // Check if the code is null or an empty string after trimming
  if (!trimmedCode) {
    return {
      isEmpty: true,
      code: '',
      startsWithDots: false,
    };
  }

  // Check if the trimmed code starts with '...'
  if (trimmedCode.startsWith('...')) {
    return {
      isEmpty: false,
      code: trimmedCode,
      startsWithDots: true,
    };
  }

  // Check if the trimmed code is shorter than 5 characters
  if (trimmedCode.length < 5) {
    return {
      isEmpty: false,
      code: trimmedCode,
      startsWithDots: true, // This is not a typo, it's intentional
    };
  }

  // If the code is not empty and does not start with '...', it's a regular code
  return {
    isEmpty: false,
    code: trimmedCode,
    startsWithDots: false,
  };
}

function processItem(
  merchantName: string,
  merchantDomain: string | null,
  item: any,
  sourceUrl: string,
  nextData: any
): ItemResult {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  const idInSite = (
    item?.idPool?.split('_')?.[1] ||
    item?.idVoucher ||
    item?.idInSite
  )?.toString();

  const description =
    item?.termsAndConditions?.text?.match(/<p>(.*)<\/p>/)?.[1] ||
    item.description;

  const termsAndConditions = item?.termsAndConditions?.captions?.length
    ? item?.termsAndConditions?.captions
        ?.map((el) => `${el?.key} ${el?.text}`)
        ?.join()
        .replaceAll(',', ' ')
    : item?.termsAndConditions;

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('description', description);
  validator.addValue('termsAndConditions', termsAndConditions);
  validator.addValue('expiryDateAt', formatDateTime(item.endTime));
  validator.addValue('startDateAt', formatDateTime(item.startTime));
  validator.addValue('isExclusive', item.isExclusive);
  validator.addValue('isExpired', item.isExpired);
  validator.addValue('isShown', true);

  // code must be checked to decide the next step
  const codeType = checkVoucherCode(item.code);

  if (codeType.isEmpty) {
    return { hasCode: false, itemUrl: '', validator };
  }

  if (!codeType.startsWithDots) {
    validator.addValue('code', codeType.code);
    return { hasCode: false, itemUrl: '', validator };
  }

  const retailerId = nextData.query.clientId;
  const retailerCountry = nextData.props.pageProps.retailer.country;
  const idPool = item.idPool;
  const assetsBaseUrl = nextData.props.pageProps.assetsBaseUrl;

  const itemUrl = `${assetsBaseUrl}/api/voucher/country/${retailerCountry}/client/${retailerId}/id/${idPool}`;

  return { hasCode: true, itemUrl, validator };
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    logger.error('Request queue is missing');
    return;
  }

  try {
    // Extracting request and body from context

    log.info(`Processing URL: ${request.url}`);

    const items = $(request.userData.pageSelectors?.indexSelector?.[0]); // next-routes - dynamic selectors

    // pre-processing hooks  here to avoid unnecessary requests
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

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Define a regex pattern to extract the JSON from the script tag
    const jsonPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;

    // Use the regex pattern to extract the JSON string
    const match = htmlContent.match(jsonPattern);

    if (!match || !match?.[1]) {
      logger.error(`'JSON data not found ${request.url}`);
      return;
    }

    const nextData = JSON.parse(match?.[1]);
    const pageProps = nextData.props.pageProps;

    if (!pageProps || !pageProps.retailer) {
      logger.error('pageProps data is missing in the parsed JSON');
      return;
    }

    // Declarations outside the loop
    const merchantName = pageProps.retailer.name;

    if (!merchantName) {
      logger.error(`merchantName not found ${request.url}`);
      return;
    }

    const merchantUrl = pageProps.retailer.merchant_url;
    const merchantDomain = getMerchantDomainFromUrl(merchantUrl);

    if (!merchantDomain) {
      log.warning(`merchantDomain not found ${request.url}`);
    }

    // Combine active and expired items
    const activeVouchers = jp.query(pageProps, '$..vouchers')?.[0] || [];
    const expiredVouchers =
      jp.query(pageProps, '$..expiredVouchers')?.[0] || [];
    const similarVouchers =
      jp.query(pageProps, '$..similarVouchers')?.[0] || [];

    const allVouchers = [...activeVouchers, ...expiredVouchers].filter(
      (voucher) =>
        !similarVouchers.some(
          (similar: any) => similar.idPool === voucher.idPool
        )
    );

    log.info(
      `Retrieved ${activeVouchers.length} active vouchers and ` +
        ` ${expiredVouchers.length} expired vouchers from ${request.url}.` +
        `Total clear vouchers: ${allVouchers.length}.`
    );

    const vouchersWithCode: any = [];
    let result: ItemResult;

    for (const item of allVouchers) {
      await sleep(1000); // Sleep for 1 second between requests to avoid rate limitings

      if (!item.idPool && !item.idVoucher && !item.idInSite) {
        logger.error(`idInSite not found in item`, item);
        continue;
      }

      if (!item.title) {
        logger.error(`title not found in item`);
        continue;
      }

      result = processItem(
        merchantName,
        merchantDomain,
        item,
        request.url,
        nextData
      );

      if (result.hasCode) {
        vouchersWithCode.push(result);
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
        log.info(`Post-Processing Error : ${error.message}`);
        return;
      }
    }

    // Add the items with codes to the request queue
    for (const voucher of vouchersWithCode) {
      const { itemUrl, validator } = voucher;

      await crawler?.requestQueue?.addRequest(
        {
          url: itemUrl,
          userData: {
            ...request.userData,
            label: Label.getCode,
            validatorData: validator.getData(),
          },
          headers: CUSTOM_HEADERS,
        },
        { forefront: true }
      );
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body, log } = context;

  if (request.userData.label !== Label.getCode) return;

  try {
    // Sleep for x seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    if (!htmlContent.startsWith('{')) {
      log.warning(`Invalid JSON string`);
      return;
    }
    // Safely parse the JSON string
    const jsonCodeData = JSON.parse(htmlContent);

    // Validate the necessary data is present
    if (!jsonCodeData || !jsonCodeData.code) {
      log.warning(`Coupon code not found ${request.url}`);
      return;
    }

    const code = jsonCodeData.code;

    log.info(`Found code: ${code}\n    at: ${request.url}`);

    // Assuming the code should be added to the validator's data
    validator.addValue('code', code);

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
