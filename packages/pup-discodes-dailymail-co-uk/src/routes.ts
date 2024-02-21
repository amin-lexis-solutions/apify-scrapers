import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  formatDateTime,
  getDomainName,
  processAndStoreData,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

declare global {
  interface Window {
    __NEXT_DATA__?: any; // You can replace `any` with a more specific type if you have one
  }
}

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

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.listing, async ({ page, request, enqueueLinks }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`\nProcessing URL: ${request.url}`);

    await page.waitForFunction(() => {
      return !!window.__NEXT_DATA__;
    });

    const htmlContent = await page.content();
    const jsonPattern = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s;
    const match = htmlContent.match(jsonPattern);

    let jsonData;
    let retailerId;
    if (match && match[1]) {
      jsonData = JSON.parse(match[1]);
      retailerId = jsonData.query.clientId;
      jsonData = jsonData.props.pageProps;
    } else {
      throw new Error(
        'No matching script tag found or no JSON content present'
      );
    }

    if (!jsonData.retailer) {
      throw new Error('Retailer data is missing in the parsed JSON');
    }

    console.log(
      `\n\nFound ${jsonData.vouchers.length} active vouchers and ${jsonData.expiredVouchers.length} expired vouchers\n    at: ${request.url}\n`
    );

    const merchantName = jsonData.retailer.name;
    const merchantUrl = jsonData.retailer.merchant_url;
    const domain = getDomainName(merchantUrl);

    const activeVouchers = jsonData.vouchers.map((voucher) => ({
      ...voucher,
      is_expired: false,
    }));
    const expiredVouchers = jsonData.expiredVouchers.map((voucher) => ({
      ...voucher,
      is_expired: true,
    }));
    const vouchers = [...activeVouchers, ...expiredVouchers];

    for (const voucher of vouchers) {
      const validator = new DataValidator();

      // Add required values to the validator
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', voucher.title);
      validator.addValue('idInSite', voucher.idVoucher);

      // Add optional values to the validator
      validator.addValue('domain', domain);
      validator.addValue('description', voucher.description);
      validator.addValue('termsAndConditions', voucher.termsAndConditions);
      validator.addValue('expiryDateAt', formatDateTime(voucher.endTime));
      validator.addValue('startDateAt', formatDateTime(voucher.startTime));
      validator.addValue('isExclusive', voucher.exclusiveVoucher);
      validator.addValue('isExpired', voucher.isExpired);
      validator.addValue('isShown', true);

      const codeType = checkVoucherCode(voucher.code);

      if (!codeType.isEmpty) {
        if (!codeType.startsWithDots) {
          validator.addValue('code', codeType.code);
          await processAndStoreData(validator);
        } else {
          const idPool = voucher.idPool;
          const codeDetailsUrl = `https://discountcode.dailymail.co.uk/api/voucher/country/uk/client/${retailerId}/id/${idPool}`;
          const validatorData = validator.getData();

          await enqueueLinks({
            urls: [codeDetailsUrl],
            userData: { label: Label.getCode, validatorData },
            forefront: true,
          });
        }
      } else {
        await processAndStoreData(validator);
      }
    }
  } catch (error) {
    console.error(`An error occurred while processing ${request.url}:`, error);
  }
});

router.addHandler(Label.getCode, async ({ page, request }) => {
  if (request.userData.label !== Label.getCode) return;

  try {
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const htmlContent = await page.content();
    const jsonPattern = /<pre[^>]*>(.*?)<\/pre>/s;
    const match = htmlContent.match(jsonPattern);

    if (match && match[1]) {
      const jsonCodeData = JSON.parse(match[1]);
      const code = jsonCodeData.code;
      console.log(`Found code: ${code}\n    at: ${request.url}`);
      validator.addValue('code', code);
      await processAndStoreData(validator);
    } else {
      throw new Error('No matching pre tag found or no JSON content present');
    }
  } catch (error) {
    console.error(`An error occurred while processing ${request.url}:`, error);
  }
});

export { router };
