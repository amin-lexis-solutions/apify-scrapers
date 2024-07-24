import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'AXEajjtg8mBd9ly8I',
    domains: [
      {
        domain: 'radins.com',
        locales: [Locale.fr_FR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
