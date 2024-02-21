import cheerio from 'cheerio';
import { RequestProvider } from 'crawlee';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, sleep } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

const CUSTOM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/117.0',
  Origin: 'https://www.picodi.com',
};

async function processCouponItem(
  requestQueue: RequestProvider,
  merchantName: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;

  if (!isExpired) {
    const elementClass = $coupon('*').first().attr('class');
    if (!elementClass) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Element class is missing');
    }

    if (
      elementClass.includes('type-code') ||
      elementClass.includes('type-promo')
    ) {
      hasCode =
        elementClass.includes('type-code') &&
        !elementClass.includes('type-promo');
    } else {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error(
        'Element class doesn\'t contain "type-code" or "type-promo"'
      );
    }

    const idInSite = $coupon('*').first().attr('data-offer-id');
    if (!idInSite) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Element data-offer-id attr is missing');
    }

    // Extract the voucher title
    const titleElement = $coupon('div.of__content > h3').first();
    if (titleElement.length === 0) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Voucher title is missing');
    }
    const voucherTitle = he.decode(titleElement.text().trim());

    // Extract the description
    let description = '';
    const descElement = $coupon('div.of__content').first();
    if (descElement.length > 0) {
      description = he
        .decode(descElement.text())
        .replace(voucherTitle, '') // remove the title from the descriptions
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace('\n\n', '\n'); // remove extra spaces, but keep the meaningful line breaks
    }

    const validator = new DataValidator();

    // Add required and optional values to the validator
    validator.addValue('sourceUrl', sourceUrl);
    validator.addValue('merchantName', merchantName);
    validator.addValue('title', voucherTitle);
    validator.addValue('idInSite', idInSite);
    validator.addValue('description', description);
    validator.addValue('isExpired', isExpired);
    validator.addValue('isShown', true);

    if (hasCode) {
      const couponUrl = `https://s.picodi.com/ch/api/offers/${idInSite}/v2`;
      // Add the coupon URL to the request queue
      await requestQueue.addRequest(
        {
          url: couponUrl,
          userData: {
            label: Label.getCode,
            validatorData: validator.getData(),
          },
          headers: CUSTOM_HEADERS,
        },
        { forefront: true }
      );
    } else {
      await processAndStoreData(validator);
    }
  }
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, body } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    // Convert body to string if it's a Buffer
    const htmlContent = body instanceof Buffer ? body.toString() : body;

    // Define a regex pattern to extract the shop name from the HTML content
    const shopNamePattern = /shopName\s*=\s*'([^']+)'/;

    const match = htmlContent.match(shopNamePattern);

    const merchantName = he.decode(match && match[1] ? match[1] : '');

    // Check if valid page
    if (!merchantName) {
      console.log(`Not Merchant URL: ${request.url}`);
    } else {
      // console.log(`Merchant Name: ${merchantName}`);
      // Extract valid coupons
      const validCoupons = $(
        'section.card-offers > ul > li.type-promo, section.card-offers > ul > li.type-code'
      );
      for (let i = 0; i < validCoupons.length; i++) {
        const element = validCoupons[i];
        await processCouponItem(
          crawler.requestQueue,
          merchantName,
          false,
          element,
          request.url
        );
      }
      // We don't extract expired coupons, because they don't have id and we cannot match them with the ones in the DB
      // const expiredCoupons = $('section.archive-offers > article');
      // for (let i = 0; i < expiredCoupons.length; i++) {
      //   const element = expiredCoupons[i];
      //   await processCouponItem(
      //     crawler.requestQueue,
      //     merchantName,
      //     true,
      //     element,
      //     request.url
      //   );
      // }
    }
  } catch (error) {
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});

router.addHandler(Label.getCode, async (context) => {
  // context includes request, body, etc.
  const { request, body } = context;

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

    let code = '';

    // Attempt to parse the HTML content as JSON
    const parsedJson = JSON.parse(htmlContent);

    // Extract the "o_c" value
    if (
      typeof parsedJson === 'object' &&
      parsedJson !== null &&
      'o_c' in parsedJson
    ) {
      code = parsedJson['o_c'].trim();
      if (code) {
        const decodedString = Buffer.from(code, 'base64').toString('utf-8');
        code = decodedString.slice(6, -6);
        console.log(`Found code: ${code}\n    at: ${request.url}`);
        validator.addValue('code', code);
      }
    }

    // Process and store the data
    await processAndStoreData(validator);
  } catch (error) {
    // Handle any errors that occurred during the handler execution
    console.error(
      `An error occurred while processing the URL ${request.url}:`,
      error
    );
  }
});
