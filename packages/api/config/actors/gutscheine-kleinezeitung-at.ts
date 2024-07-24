import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'PwM2HbvD7TveaFZUD',
    domains: [
      {
        domain: 'gutscheine.kleinezeitung.at',
        locales: [Locale.de_AT],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
