import * as cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, generateHash } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

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

  await processAndStoreData(validator);
}

// Export the router function that determines which handler to use based on the request label
const router = createCheerioRouter();

router.addHandler(Label.listing, async ({ request, body }) => {
  if (request.userData.label !== Label.listing) return;

  try {
    console.log(`\nProcessing URL: ${request.url}`);
    const htmlContent = body instanceof Buffer ? body.toString() : body;
    const $ = cheerio.load(htmlContent);

    let merchantName = $(
      'section.brand-index_content-heading-block a img'
    ).attr('title');
    if (!merchantName) {
      throw new Error('Unable to find merchant name');
    }

    merchantName = merchantName.replace('Descuentos', '').trim();

    // Refactor to use a loop for valid coupons
    const validCoupons = $('ul.main-section_discounts > li > div.card-primary');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // Do nothing
  }
});

export { router };
