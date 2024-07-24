import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'FqbDWz0KKZiWDDUHe',
    domains: [
      {
        domain: 'kodvpalto.ru',
        locales: [Locale.ru_RU],
      },
      {
        domain: 'codepoche.fr',
        locales: [Locale.fr_FR],
      },
      {
        domain: 'ilovebargain.com',
        locales: [
          Locale.en_SG,
          Locale.en_HK,
          Locale.en_IN,
          Locale.en_PH,
          Locale.en_MY,
          Locale.en_AE,
        ],
        routes: {
          '/sg': Locale.en_SG,
          '/hk': Locale.en_HK,
          '/in': Locale.en_IN,
          '/ph': Locale.en_PH,
          '/my': Locale.en_MY,
          '/ar': Locale.en_AE,
        },
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
