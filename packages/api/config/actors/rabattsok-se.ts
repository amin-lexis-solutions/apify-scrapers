import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'qP7ELPdriEUmHC8kX',
    domains: [
      {
        domain: 'rabattsok.se',
        locales: [Locale.sv_SE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
