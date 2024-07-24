import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'k3ggVQpvlfO2mnjhW',
    domains: [
      {
        domain: 'codepromo.lexpress.fr',
        locales: [Locale.fr_FR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
