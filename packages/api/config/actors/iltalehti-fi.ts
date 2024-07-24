import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'uR6FH4MBVqz27c9MJ',
    domains: [
      {
        domain: 'iltalehti.fi',
        locales: [Locale.fi_FI],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
