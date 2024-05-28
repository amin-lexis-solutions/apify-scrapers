import * as cheerio from 'cheerio';
import { createCheerioRouter, Dataset } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import {
  processAndStoreData,
  generateHash,
  checkExistingCouponsAnomaly,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

// Define a function to check if the page matches the selectors
function isIndexPage(
  $: cheerio.Root,
  indexPageSelectors: string[],
  nonIndexPageSelectors: string[]
): boolean {
  const isIndexPage = indexPageSelectors.some(
    (selector) => $(selector).length > 0
  );
  const isNonIndexPage = nonIndexPageSelectors.some(
    (selector) => $(selector).length > 0
  );

  return isIndexPage && !isNonIndexPage;
}

async function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  // Extract the voucher title
  const titleElement = $coupon('div.card-primary__title');
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = titleElement.text().trim();

  // Extract the description
  const descElement = $coupon('div.card-primary__description');
  const description = descElement.length > 0 ? descElement.text().trim() : '';

  // Extract the code
  let code = '';
  const codeElement = $coupon('p.code');

  if (codeElement.length > 0) {
    code = codeElement.text().trim();
  }

  const dataId = generateHash(merchantName, voucherTitle, sourceUrl);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', dataId);
  validator.addValue('description', description);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);
  if (code) {
    validator.addValue('code', code);
  }

  await processAndStoreData(validator, context);
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, body, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    log.info(`\nProcessing URL: ${request.url}`);
    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    // Check if this is an index page
    const indexPageSelectors = ['.brand-index_content-main', '.brand-index']; // Add selectors that are present on the index page
    const nonIndexPageSelectors = ['.home-index']; // Add selectors that are present on the other page

    if (!isIndexPage($, indexPageSelectors, nonIndexPageSelectors)) {
      log.info(`Skip URL: ${request.url} - Not a data page`);
      await Dataset.pushData({
        __isNotIndexPage: true,
        __url: request.url,
      });
      return;
    }

    let merchantName = $(
      'section.brand-index_content-heading-block a img'
    ).attr('title');
    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }

    merchantName = merchantName.replace('Descuentos', '').trim();

    // Refactor to use a loop for valid coupons
    const validCoupons = $('ul.main-section_discounts > li > div.card-primary');

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      return;
    }

    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
