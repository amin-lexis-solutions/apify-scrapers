import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '1FBcghRUmg5HYLczo',
    domains: [
      {
        domain: 'pelando.com.br',
        locales: [Locale.pt_BR],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
