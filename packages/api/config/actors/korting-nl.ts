import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '6dtg2ZX6ULR2lpTtG',
    domains: [
      {
        domain: 'korting.nl',
        locales: [Locale.nl_NL],
        proxyCountryCode: 'NL',
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
