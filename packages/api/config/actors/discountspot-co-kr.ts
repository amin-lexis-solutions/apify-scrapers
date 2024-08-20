import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'cND2P07VaXDPeix0B',
    domains: [
      {
        domain: 'discountspot.co.kr',
        locales: [Locale.ko_KR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
    // maxStartUrls: 1000, // Uncomment this line to custom the max start URLs of your actor
  },
];
