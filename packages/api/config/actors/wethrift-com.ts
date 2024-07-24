import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'n3lZ98y4mcUtiW1Z6',
    domains: [
      {
        domain: 'wethrift.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
