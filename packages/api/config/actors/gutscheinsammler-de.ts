import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'jiqX9kJASkRZPUpsO',
    domains: [
      {
        domain: 'gutscheinsammler.de',
        locales: [Locale.de_DE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
