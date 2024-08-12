import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '27mFdG0jeWvhoza2f',
    domains: [
      {
        domain: 'dontpayfull.com',
        locales: [Locale.en_US],
        proxyCountryCode: 'US',
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
