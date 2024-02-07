import { RequestProvider } from 'crawlee';
import { OfferItem, Label, CUSTOM_HEADERS } from './constants';
import { DataValidator } from './data-validator';
import { processAndStoreData } from './utils';

export async function processCouponItem(
  requestQueue: RequestProvider,
  merchantName: string,
  domain: string,
  couponItem: OfferItem,
  sourceUrl: string
) {
  const voucherTitle = couponItem.node.title;

  const idInSite = couponItem.node.voucher.id.split(':')[3]; // value is like ":hinge:vouchers:123456"

  const hasCode = couponItem.node.voucher.hasVoucherCode;

  const code = couponItem.node.voucher.code;

  const isExclusive = couponItem.node.voucher.exclusive;

  let limitProduct = couponItem.node.voucher.limitProduct.trim();
  if (limitProduct === '') {
    limitProduct = 'keine';
  }

  let savingValue = '';
  if (couponItem.node.voucher.savingType === 1) {
    savingValue = `${couponItem.node.voucher.savingValue}%`;
  } else {
    savingValue = `CHF ${couponItem.node.voucher.savingValue}`;
  }

  const description = `Gutscheinwert: ${limitProduct}\nGilt für:\n    ${savingValue}\n    alle Kunden`

  const validator = new DataValidator();

  // Add required and optional values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('domain', domain);
  validator.addValue('title', voucherTitle);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', false);
  validator.addValue('isExclusive', isExclusive);
  validator.addValue('isShown', true);

  if (hasCode) {
    if (code !== null && code.trim() !== '') {
      validator.addValue('code', code);
      await processAndStoreData(validator);
    } else {
      const couponUrl = `https://www.sparwelt.de/hinge/vouchercodes/${idInSite}`;
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
    }
  } else {
    await processAndStoreData(validator);
  }
}
