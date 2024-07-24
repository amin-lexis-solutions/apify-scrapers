import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'DGgL1NJ0x2fsAmmE5',
    domains: [
      {
        domain: 'discountcode.dailymail.co.uk',
        locales: [Locale.en_GB],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
