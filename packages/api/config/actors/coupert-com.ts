import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '26OcADUt32W2YHi6u',
    domains: [
      {
        domain: 'kr.coupert.com',
        locales: [Locale.ko_KR],
        // proxyCountryCode: 'US',
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
    // maxStartUrls: 1000, // Uncomment this line to custom the max start URLs of your actor
  },
];
