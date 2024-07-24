import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'JPA7emncpprCDZ4xs',
    domains: [
      {
        domain: 'kortingscode.nl',
        locales: [Locale.nl_NL],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
