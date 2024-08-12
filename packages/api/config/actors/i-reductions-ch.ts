import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'JJ8V36nS2Mj3YciFh',
    domains: [
      {
        domain: 'i-reductions.ch',
        locales: [Locale.fr_CH],
        proxyCountryCode: 'CH',
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
