import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'uHmwoz9vpNssOw5ER',
    domains: [
      {
        domain: 'monbon.fr',
        locales: [Locale.fr_FR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
