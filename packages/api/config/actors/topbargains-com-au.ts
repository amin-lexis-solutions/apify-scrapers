import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'MQiPwlLsilqlYcu1e',
    domains: [
      {
        domain: 'topbargains.com.au',
        locales: [Locale.en_AU],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
