import cheerio from 'cheerio';
import { createCheerioRouter } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, generateHash } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

function extractMerchantName(rawName: string): string {
  // Regular expression to find the first occurrence of
  // a word starting with "korting"
  const regex = /\bkorting.*?\b/i; // 'i' == case-insensitive

  // Split the string using the regex and take the first part
  const [merchantName] = rawName.split(regex);

  return merchantName.trim();
}

async function processCouponItem(
  merchantName: string,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let hasCode = false;

  const elemCode = $coupon('span.coupon_text').first();

  if (elemCode.length > 0) {
    hasCode = true;
  }

  // Extract the voucher title
  const titleElement = $coupon('h3').first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(titleElement.text().trim());

  const idInSite = generateHash(merchantName, voucherTitle, sourceUrl);

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  if (hasCode) {
    const coupon = elemCode.text().trim();
    validator.addValue('code', coupon);
  }
  await processAndStoreData(validator);
  return true;
}

export const router = createCheerioRouter();

router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    throw new Error('Request queue is missing');
  }

  try {
    // Extracting request and body from context

    console.log(`\nProcessing URL: ${request.url}`);

    const h1Element = $('div.woo-tax-name > h1');
    let merchantName = '';
    if (h1Element.length > 0) {
      merchantName = extractMerchantName(h1Element.text());
    }

    if (!merchantName) {
      throw new Error('Merchant name is missing');
    }

    // Extract valid coupons
    const validCoupons = $('article.offer_grid');
    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // Do nothing
  }
});
