import { Locale } from './locales';
enum status {
  accepted = 'accepted',
  rejected = 'rejected',
  pending = 'pending',
}

export const candidateDomains: any = {
  [Locale.en_US]: [
    {
      domain: 'joinhoney.com',
      status: status.accepted,
    },
    {
      domain: 'offers.com',
      status: status.accepted,
    },
    {
      domain: 'couponchief.com',
      status: status.pending,
    },
    {
      domain: 'couponbirds.com',
      status: status.pending,
    },
    {
      domain: 'coupons.com',
      status: status.accepted,
    },
    {
      domain: 'savings.com',
      status: status.accepted,
    },
    {
      domain: 'couponcabin.com',
      status: status.rejected,
    },
    {
      domain: 'hotdeals.com',
      status: status.pending,
    },
    {
      domain: 'sociablelabs.com',
      status: status.pending,
    },
    {
      domain: 'dealdrop.com',
      status: status.pending,
    },
    {
      domain: 'www.tenereteam.com/coupons',
      status: status.pending,
    },
    {
      domain: 'worthepenny.com',
      status: status.pending,
    },
  ],
  [Locale.es_AR]: [
    {
      domain: 'descuento.com.ar',
      status: status.pending,
    },
    {
      domain: 'radarcupon.com.ar',
      status: status.rejected,
    },
  ],
  [Locale.es_CL]: [
    {
      domain: 'www.jdescuentos.cl',
      status: status.pending,
    },
    {
      domain: 'www.descuento.cl',
      status: status.pending,
    },
    {
      domain: 'cupon.cl',
      status: status.accepted,
    },
    {
      domain: 'www.codigodescuento.cl',
      status: status.pending,
    },
    {
      domain: '1001cuponesdedescuento.cl',
      status: status.accepted,
    },
  ],
  [Locale.es_CO]: [
    {
      domain: 'radarcupon.com.co',
      status: status.rejected,
    },
    {
      domain: 'cupon.com.co',
      status: status.pending,
    },
    {
      domain: '1001cuponesdedescuento.com.co',
      status: status.accepted,
    },
  ],
  [Locale.fi_FI]: [
    {
      domain: 'alehinta.fi',
      status: status.rejected,
    },
    {
      domain: 'promo-codes.fi',
      status: status.pending,
    },
    {
      domain: 'cuponation.fi',
      status: status.accepted,
    },
    {
      domain: 'fi.coupert.com',
      status: status.pending,
    },
    {
      domain: 'fi.promocodie.com',
      status: status.pending,
    },
    {
      domain: 'promocodius.com/fi/',
      status: status.pending,
    },
    {
      domain: 'www.mmodm.com/gigantti.fi-coupon-codes/', // coupons community site
      status: status.pending,
    },
    {
      domain: 'alennuskoodini.fi',
      status: status.accepted,
    },
  ],
  [Locale.en_IE]: [
    {
      domain: 'lovevouchers.ie',
      status: status.accepted,
    },
    {
      domain: 'discountcodes.irishtimes.com',
      status: status.accepted,
    },
    {
      domain: 'voucher-code.ie',
      status: status.pending,
    },
    {
      domain: 'everysaving.ie',
      status: status.rejected,
    },
    {
      domain: 'promotionalcodes.ie',
      status: status.pending,
    },
    {
      domain: 'savvyspender.ie',
      status: status.pending,
    },
  ],
  [Locale.en_KE]: [
    {
      domain: 'kenyancoupons.net',
      status: status.pending,
    },
  ],
  [Locale.es_PE]: [
    {
      domain: '1001cuponesdedescuento.com.pe',
      status: status.pending,
    },
  ],
  [Locale.en_SG]: [
    {
      domain: 'deala.com', // this coupons site  have coupons for multiple brands worldwide
      status: status.pending,
    },
    {
      domain: 'collectoffers.com/sg/', // this coupons site available in 22 countries
      status: status.pending,
    },
  ],
  [Locale.sk_SK]: [
    {
      domain: 'promokupon.sk',
      status: status.pending,
    },
  ],
  [Locale.en_PH]: [
    {
      domain: 'rezeem.ph',
      status: status.pending,
    },
  ],
  [Locale.en_IN]: [
    {
      domain: 'coupondunia.in',
      status: status.pending,
    },
    {
      domain: 'savee.in',
      status: status.pending,
    },
    {
      domain: 'bankofbaroda.in',
      status: status.pending,
    },
  ],
  [Locale.hu_HU]: [
    {
      domain: 'legjobbkuponok.hu',
      status: status.pending,
    },
    {
      domain: 'kuponkodok.hu',
      status: status.pending,
    },
  ],
};
