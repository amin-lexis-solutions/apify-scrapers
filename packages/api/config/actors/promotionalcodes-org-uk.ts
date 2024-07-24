import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '6xBOlnSSnIatHemB1',
    domains: [
      {
        domain: 'promotionalcodes.org.uk',
        locales: [Locale.en_GB],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
