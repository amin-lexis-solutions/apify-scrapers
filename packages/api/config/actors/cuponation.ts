import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: '53fGllHXsa6FgT0li',
    domains: [
      {
        domain: 'cuponation.ch',
        locales: [Locale.de_CH],
      },
      {
        domain: 'cuponation.com.au',
        locales: [Locale.en_AU],
      },
      {
        domain: 'cuponation.com.my',
        locales: [Locale.en_MY],
      },
      {
        domain: 'cuponation.com.br',
        locales: [Locale.pt_BR],
      },
      {
        domain: 'cuponation.com.sg',
        locales: [Locale.en_SG],
      },
      {
        domain: 'cuponation.fi',
        locales: [Locale.fi_FI],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
  },
];
