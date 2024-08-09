import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'LsNFUXSpGtQD7q0MR',
    domains: [
      {
        domain: 'drivereasy.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
