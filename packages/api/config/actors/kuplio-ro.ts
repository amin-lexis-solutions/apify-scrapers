import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'Q3C3EqJdUaogMiges',
    domains: [
      {
        domain: 'kuplio.ro',
        locales: [Locale.ro_RO],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
