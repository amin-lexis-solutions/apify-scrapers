import { createCheerioRouter } from 'crawlee';
import { parse } from 'node-html-parser';
import { DataValidator } from 'shared/data-validator';
import { getMerchantDomainFromUrl, logError, sleep } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

async function fetchItemCode(itemCodeURL: string): Promise<string | null> {
  try {
    const response = await fetch(itemCodeURL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const itemCodeJSON = await response.json();
    const itemCode = itemCodeJSON.voucher_code;
    if (itemCode && itemCode !== '' && itemCode !== 'kein Code notwendig') {
      console.log(`Item code: ${itemCode}`);
      return itemCode;
    }
    return null;
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, log, body, enqueueLinks } = context;

  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`Listing ${request.url}`);

    const content = typeof body === 'string' ? body : body.toString();

    const sectionWithItems = parse(content).querySelector(
      '.providerpage__section:has(div#gutscheine)'
    );

    if (!sectionWithItems) {
      logError('No coupons found');
      return;
    }

    const items = sectionWithItems.querySelectorAll(
      'div.voucher-teaser-list > div'
    );

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
      logError(`Pre-Processing Error : ${error.message}`);
      return;
    }

    log.info(`Coupons count ${items.length}`);

    for (const item of items) {
      const itemId = item.getAttribute('data-ssr-vouchers-item');

      if (!itemId) {
        logError('Item ID not found in div HTML tag.');
        continue;
      }

      const hasCode = !item.querySelector('button.ui-btn--ci-blue-600');

      log.info(`Item ID ${itemId} has code: ${hasCode}`);

      const detailsUrl = `https://www.sparwelt.de/hinge/graphql?query=%0A++query+VoucherById($id:+ID!)+%7B%0A++++voucher(id:+$id)+%7B%0A++++++id%0A++++++title%0A++++++provider+%7B%0A++++++++id%0A++++++++title%0A++++++++slug%0A++++++++domainUrl%0A++++++++image%0A++++++++affiliateDeeplink+%7B%0A++++++++++url%0A++++++++++id%0A++++++++%7D%0A++++++++minOrderValueWording%0A++++++%7D%0A++++++affiliateDeeplink+%7B%0A++++++++id%0A++++++++url%0A++++++%7D%0A++++++teaserDescription%0A++++++savingValue%0A++++++savingType%0A++++++minOrderValue%0A++++++limitProduct%0A++++++limitCustomer%0A++++++dateEnd%0A++++%7D%0A++%7D%0A&variables=%7B%22id%22:%22%2Fhinge%2Fvouchers%2F${itemId}%22%7D`;

      const validator = new DataValidator();

      validator.addValue('sourceUrl', request.url);
      validator.addValue('idInSite', itemId);

      if (hasCode) {
        const itemCodeURL = `https://www.sparwelt.de/hinge/vouchercodes/${itemId}`;
        const itemCode = await fetchItemCode(itemCodeURL);
        if (itemCode) {
          validator.addValue('code', itemCode);
        }
      }

      // Forward to the details page
      await enqueueLinks({
        urls: [detailsUrl],
        userData: {
          label: Label.details,
          validatorData: validator.getData(),
        },
        forefront: true,
      });
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.details, async (context) => {
  const { request, body, log } = context;

  if (request.userData.label !== Label.details) return;

  try {
    // Sleep for 3 seconds between requests to avoid rate limitings
    await sleep(1000);

    // Retrieve validatorData from request's userData
    const validatorData = request.userData.validatorData;

    // Create a new DataValidator instance and load the data
    const validator = new DataValidator();
    validator.loadData(validatorData);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Safely parse the JSON string
    const voucherJson = JSON.parse(htmlContent);

    // Validate the necessary data is present
    if (!voucherJson || !voucherJson.data || !voucherJson.data.voucher) {
      log.warning('Voucher data is missing in the parsed JSON');
    }

    // Extract voucher data from JSON
    const voucher = voucherJson.data.voucher;
    const provider = voucher.provider;

    // Extract domain name from URL
    const merchantUrl = provider.domainUrl;
    const domainName = getMerchantDomainFromUrl(merchantUrl);

    // Populate the validator with data
    // Add required values to the validator
    validator.addValue('merchantName', provider.title);
    validator.addValue('title', voucher.title);

    // Add optional values to the validator
    validator.addValue('domain', domainName);
    validator.addValue('description', voucher.teaserDescription);
    // Terms and Conditions, Start Date, Code, and Exclusive are not available in the JSON
    // If you have these details from another source, add them here
    validator.addValue('expiryDateAt', voucher.dateEnd);
    validator.addValue('isShown', true);

    // Process and store the data
    await postProcess(
      {
        SaveDataHandler: {
          validator: validator,
        },
      },
      context
    );
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
