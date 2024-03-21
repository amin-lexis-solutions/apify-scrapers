import { createCheerioRouter } from 'crawlee';
import { parse } from 'node-html-parser';
import { DataValidator } from 'shared/data-validator';
import { getDomainName, processAndStoreData, sleep } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

async function fetchVoucherCode(
  voucherCodeURL: string
): Promise<string | null> {
  try {
    const response = await fetch(voucherCodeURL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const voucherCodeJson = await response.json();
    const voucherCode = voucherCodeJson.voucher_code;
    if (
      voucherCode &&
      voucherCode !== '' &&
      voucherCode !== 'kein Code notwendig'
    ) {
      console.log(`Voucher code: ${voucherCode}`);
      return voucherCode;
    }
    return null;
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async ({ request, body, enqueueLinks }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`Request URL: ${request.url}`);
    const content = typeof body === 'string' ? body : body.toString();

    const sectionWithCoupons = parse(content).querySelector(
      '.providerpage__section:has(div#gutscheine)'
    );

    if (sectionWithCoupons) {
      const selCoupons = sectionWithCoupons.querySelectorAll(
        'div.voucher-teaser-list > div'
      );
      if (selCoupons.length > 0) {
        console.log(`Found ${selCoupons.length} coupons`);

        for (const couponDiv of selCoupons) {
          const voucherId = couponDiv.getAttribute('data-ssr-vouchers-item');
          if (voucherId) {
            console.log(`Found voucher ID: ${voucherId}`);
            const hasCode = !couponDiv.querySelector(
              'button.ui-btn--ci-blue-600'
            );
            console.log(`Voucher ID ${voucherId} has code: ${hasCode}`);

            const detailsUrl = `https://www.sparwelt.de/hinge/graphql?query=%0A++query+VoucherById($id:+ID!)+%7B%0A++++voucher(id:+$id)+%7B%0A++++++id%0A++++++title%0A++++++provider+%7B%0A++++++++id%0A++++++++title%0A++++++++slug%0A++++++++domainUrl%0A++++++++image%0A++++++++affiliateDeeplink+%7B%0A++++++++++url%0A++++++++++id%0A++++++++%7D%0A++++++++minOrderValueWording%0A++++++%7D%0A++++++affiliateDeeplink+%7B%0A++++++++id%0A++++++++url%0A++++++%7D%0A++++++teaserDescription%0A++++++savingValue%0A++++++savingType%0A++++++minOrderValue%0A++++++limitProduct%0A++++++limitCustomer%0A++++++dateEnd%0A++++%7D%0A++%7D%0A&variables=%7B%22id%22:%22%2Fhinge%2Fvouchers%2F${voucherId}%22%7D`;
            const validator = new DataValidator();
            validator.addValue('sourceUrl', request.url);
            validator.addValue('idInSite', voucherId);
            const validatorData = validator.getData();

            if (hasCode) {
              const voucherCodeURL = `https://www.sparwelt.de/hinge/vouchercodes/${voucherId}`;
              const voucherCode = await fetchVoucherCode(voucherCodeURL);
              if (voucherCode) {
                validator.addValue('code', voucherCode);
              }
            }

            // Forward to the details page
            await enqueueLinks({
              urls: [detailsUrl],
              userData: {
                label: Label.details,
                validatorData: validatorData,
              },
              forefront: true,
            });
          } else {
            console.warn('Voucher ID is missing in a coupon div.');
          }
        }
      } else {
        console.log('No coupons found in the specified section');
      }
    } else {
      console.log('No section found with div#gutscheine');
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

router.addHandler(Label.details, async ({ request, body }) => {
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
      console.log(voucherJson);
      throw new Error('Voucher data is missing in the parsed JSON');
    }

    // Extract voucher data from JSON
    const voucher = voucherJson.data.voucher;
    const provider = voucher.provider;

    // Extract domain name from URL
    const merchantUrl = provider.domainUrl;
    const domainName = getDomainName(merchantUrl);

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
    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
