import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'ZayOJBSPEVPfSwahQ',
    domains: [
      {
        domain: 'halincode.com',
        locales: [Locale.ko_KR],
        // proxyCountryCode: 'US', //  Uncomment this line to set proxy country code of your actor
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
    // maxStartUrls: 1000, // Uncomment this line to custom the max start URLs of your actor
  },
];
