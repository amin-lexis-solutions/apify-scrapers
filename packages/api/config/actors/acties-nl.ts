import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'hs2vHdztdLtkP2lBq',
    domains: [
      {
        domain: 'acties.nl',
        locales: [Locale.nl_NL],
        proxyCountryCode: 'NL',
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
