import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'pV9a5g0NeXaCtuuts',
    domains: [
      {
        domain: 'signorsconto.it',
        locales: [Locale.it_IT],
      },
      {
        domain: 'cupones.es',
        locales: [Locale.es_ES],
      },
      {
        domain: 'rabathelten.dk',
        locales: [Locale.da_DK],
      },
      {
        domain: 'rabattkalas.se',
        locales: [Locale.sv_SE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
