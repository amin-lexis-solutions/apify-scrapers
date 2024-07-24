import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'i7xwOrJTQfutyw7ez',
    domains: [
      {
        domain: 'gutscheine.blick.ch',
        locales: [Locale.de_CH],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
