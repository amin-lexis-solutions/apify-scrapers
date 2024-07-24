import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'GI92rsylyu0OaooNl',
    domains: [
      {
        domain: 'alennuskoodit.suomi24.fi',
        locales: [Locale.fi_FI],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
