import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'wxfA0w8DEqCtKKspV',
    domains: [
      {
        domain: 'offers.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
