import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'X08aUcWVtiCCJ2nm9',
    domains: [
      {
        domain: 'bargainmoose.ca',
        locales: [Locale.en_CA],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
