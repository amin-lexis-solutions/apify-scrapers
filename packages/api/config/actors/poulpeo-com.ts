import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '32NnFvBo5wte3nh9f',
    domains: [
      {
        domain: 'poulpeo.com',
        locales: [Locale.fr_FR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
