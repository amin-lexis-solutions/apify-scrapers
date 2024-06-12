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
      status: status.pending,
    },
    {
      domain: 'www.codigodescuento.cl',
      status: status.pending,
    },
    {
      domain: '1001cuponesdedescuento.cl',
      status: status.pending,
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
      status: status.pending,
    },
  ],
};
