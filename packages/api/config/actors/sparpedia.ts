import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '38tWc5oqr3W9W7NJQ',
    domains: [
      {
        domain: 'sparpedia.dk',
        locales: [Locale.da_DK],
      },
      {
        domain: 'sparpedia.no',
        locales: [Locale.nb_NO],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
