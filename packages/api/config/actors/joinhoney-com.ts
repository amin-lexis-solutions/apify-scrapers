import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'QRGZON1mQLil1OcTf',
    domains: [
      {
        domain: 'joinhoney.com/',
        locales: [Locale.en_US],
        // proxyCountryCode: 'US',
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
    // maxStartUrls: 1000, // Uncomment this line to custom the max start URLs of your actor
  },
];
