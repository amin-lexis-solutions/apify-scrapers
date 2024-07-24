import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'F1LGSk4KRLhbb8bOp',
    domains: [
      {
        domain: 'gutscheine.chip.de',
        locales: [Locale.de_DE],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
