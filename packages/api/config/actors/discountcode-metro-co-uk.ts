import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'z5RxDIQgJispxmUS1',
    domains: [
      {
        domain: 'discountcode.metro.co.uk',
        locales: [Locale.en_GB],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
