import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'Hknvq8kXV1Km9HEnK',
    domains: [
      {
        domain: 'retailmenot.com',
        locales: [Locale.en_US],
        proxyCountryCode: 'US',
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
