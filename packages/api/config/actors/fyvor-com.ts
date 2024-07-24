import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'BJ0jovOycVNS51CQE',
    domains: [
      {
        domain: 'fyvor.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
