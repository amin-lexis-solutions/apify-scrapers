import { Locale } from '../locales';
import path from 'path';

export default [
  {
    apifyActorId: 'IXG37UOZBY8NtV4jp', // Modify this line to match the actor ID of your actor
    domains: [
      {
        domain: 'vouchercodes.co.uk',
        locales: [Locale.en_GB], // Modify this line to match the locales of your actor
        // proxyCountryCode: 'US', //  Uncomment this line to set proxy country code of your actor
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
    // maxStartUrls: 1000, // Uncomment this line to custom the max start URLs of your actor
  },
];
