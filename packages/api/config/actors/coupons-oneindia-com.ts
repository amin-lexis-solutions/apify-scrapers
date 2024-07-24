import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'lgr8bwqepENS9cNpf',
    domains: [
      {
        domain: 'coupons.oneindia.com',
        locales: [Locale.en_IN],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
