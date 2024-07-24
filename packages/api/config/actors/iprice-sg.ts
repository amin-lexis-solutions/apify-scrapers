import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'bjlyD8L6xZSQnE8Ni',
    domains: [
      {
        domain: 'iprice.sg',
        locales: [Locale.en_SG],
      },
      {
        domain: 'iprice.my',
        locales: [Locale.en_MY],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
