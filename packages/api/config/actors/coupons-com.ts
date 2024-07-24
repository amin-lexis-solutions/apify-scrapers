import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'Ly5F1hpAp3slg7dsR',
    domains: [
      {
        domain: 'coupons.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
