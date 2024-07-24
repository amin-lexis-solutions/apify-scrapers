import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'tOvdEfageXsDsTqCf',
    domains: [
      {
        domain: 'savings.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
