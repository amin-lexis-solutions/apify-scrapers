import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'aUa6nMaBNyo4vtmFt',
    domains: [
      {
        domain: 'descuentos.elpais.com',
        locales: [Locale.es_ES],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
