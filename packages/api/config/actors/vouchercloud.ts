import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'C536JcEAK0Bo5Ojlz',
    domains: [
      {
        domain: 'vouchercloud.de',
        locales: [Locale.de_DE],
        proxyCountryCode: 'DE',
      },
      {
        domain: 'vouchercloud.com',
        locales: [Locale.en_GB],
      },
      {
        domain: 'vouchercloud.ie',
        locales: [Locale.en_IE],
      },
      {
        domain: 'vouchercloud.fr',
        locales: [Locale.fr_FR],
        proxyCountryCode: 'FR',
      },
      {
        domain: 'voucher-cloud.com.au',
        locales: [Locale.en_AU],
      },
      {
        domain: 'vouchercloudbr.com.br',
        locales: [Locale.pt_BR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
