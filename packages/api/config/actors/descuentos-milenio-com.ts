import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'wdX0lCBLy8RO79kSa',
    domains: [
      {
        domain: 'descuentos.milenio.com',
        locales: [Locale.es_MX],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
