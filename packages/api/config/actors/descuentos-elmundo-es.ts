import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'OAVL1D4SrgfoHULig',
    domains: [
      {
        domain: 'descuentos.elmundo.es',
        locales: [Locale.es_ES],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
