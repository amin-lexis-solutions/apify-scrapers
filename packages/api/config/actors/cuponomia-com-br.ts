import { Locale } from '../locales';
import path from 'path';

// this site have 3 other locales chile, colombia and mexico
export default [
  {
    apifyActorId: 's8mpQxHhRl9BZtG7q',
    domains: [
      {
        domain: 'cuponomia.com.br',
        locales: [Locale.pt_BR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
