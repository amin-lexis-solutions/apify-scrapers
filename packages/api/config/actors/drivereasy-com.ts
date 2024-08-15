import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'OTWlCtkpCMIhYv2Dd',
    domains: [
      {
        domain: 'drivereasy.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
