import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'EX9Gdu1ToGra8sbMP',
    domains: [
      {
        domain: 'tecmundo.com.br',
        locales: [Locale.pt_BR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
