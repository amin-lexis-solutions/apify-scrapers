import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '32NnFvBo5wte3nh9f',
    domains: [
      {
        domain: 'poulpeo.com',
        locales: [Locale.fr_FR],
        proxyCountryCode: 'FR',
      },
    ],
    maxStartUrls: 500,
    name: path.basename(__filename, path.extname(__filename)),
  },
];
