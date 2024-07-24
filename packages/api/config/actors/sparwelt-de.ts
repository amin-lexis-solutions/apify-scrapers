import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'D8kYRkZU5bcbWMzQ1',
    domains: [
      {
        domain: 'apisparwelt.de',
        locales: [Locale.de_DE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
