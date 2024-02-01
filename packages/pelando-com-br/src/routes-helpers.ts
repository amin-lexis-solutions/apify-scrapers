import cheerio from 'cheerio';
import * as he from 'he';
import { DataValidator } from './data-validator';
import { processAndStoreData, generateHash } from './utils';

export async function processCouponItem(
  merchantName: string,
  domain: string,
  isExpired: boolean,
  couponElement: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(couponElement);

  let titleCss = '';
  let codeCss = '';
  let codeAttr = '';
  if (!isExpired) {
    titleCss = 'h3';
    codeCss = 'span[data-masked]';
    codeAttr = 'data-masked';
  } else {
    titleCss = 'p.sc-glNIji';
    codeCss = 'button.sc-eYFTNc[title]';
    codeAttr = 'title';
  }

  // Extract the voucher title
  const titleElement = $coupon(titleCss).first();
  if (titleElement.length === 0) {
    console.log('Coupon HTML:', $coupon.html());
    throw new Error('Voucher title is missing');
  }
  const voucherTitle = he.decode(
    titleElement
      .text()
      .trim()
      .replace(/[\s\t\r\n]+/g, ' ')
  );

  const idInSite = generateHash(merchantName, voucherTitle, sourceUrl);

  // Extract the voucher code
  const codeElement = $coupon(codeCss).first();
  let code = '';
  if (codeElement.length !== 0) {
    code = codeElement.attr(codeAttr) || '';
    if (!code) {
      console.log('Coupon HTML:', $coupon.html());
      throw new Error('Voucher code is missing');
    }
  }

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (code) {
    validator.addValue('code', code);
  }

  await processAndStoreData(validator);
}
