import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'LSuJSDcILgQV4JoU7',
    domains: [
      {
        domain: 'gutscheine.focus.de',
        locales: [Locale.de_DE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
