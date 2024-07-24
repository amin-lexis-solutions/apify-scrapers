import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'kk5pdikOLGixKevAz',
    domains: [
      {
        domain: 'shopper.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
