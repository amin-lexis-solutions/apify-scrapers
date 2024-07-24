import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'rDxNsvFgMMY6WtSfi',
    domains: [
      {
        domain: 'sparwelt.de',
        locales: [Locale.de_DE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
