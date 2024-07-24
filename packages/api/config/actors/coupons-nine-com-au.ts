import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'DfKj1xDVK5WdihR48',
    domains: [
      {
        domain: 'coupons.nine.com.au',
        locales: [Locale.en_AU],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
