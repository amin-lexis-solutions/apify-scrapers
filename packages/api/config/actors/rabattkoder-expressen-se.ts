import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '8tnfZ0cUcaKJG5cFV',
    domains: [
      {
        domain: 'rabattkoder.expressen.se',
        locales: [Locale.sv_SE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
