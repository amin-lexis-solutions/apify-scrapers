import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'RLqAP1IFg1DDkLnpx',
    domains: [
      {
        domain: 'coupons.businessinsider.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
