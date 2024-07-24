import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'c3cBBONbb7vmcsyu8',
    domains: [
      {
        domain: 'dealspotr.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
