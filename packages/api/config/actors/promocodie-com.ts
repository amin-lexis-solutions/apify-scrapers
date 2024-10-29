import { Locale } from '../locales';
import path from 'path';

// Ref:https://github.com/OberstBV/apify-scrapers/issues/570
// Actor ID : KJhCl7i4ECa0Hg6Ri  in case we want to re-enable it
export default [
  {
    apifyActorId: null,
    domains: [
      {
        domain: 'br.promocodie.com',
        locales: [Locale.pt_BR],
      },
      {
        domain: 'cl.promocodie.com',
        locales: [Locale.es_CL],
      },
      {
        domain: 'cz.promocodie.com',
        locales: [Locale.cs_CZ],
      },
      {
        domain: 'de.promocodie.com',
        locales: [Locale.de_DE],
      },
      {
        domain: 'dk.promocodie.com',
        locales: [Locale.da_DK],
      },
      {
        domain: 'es.promocodie.com',
        locales: [Locale.es_ES],
      },
      {
        domain: 'fi.promocodie.com',
        locales: [Locale.fi_FI],
      },
      {
        domain: 'mx.promocodie.com',
        locales: [Locale.es_MX],
      },
      {
        domain: 'nl.promocodie.com',
        locales: [Locale.nl_NL],
      },
      {
        domain: 'no.promocodie.com',
        locales: [Locale.nb_NO],
      },
      {
        domain: 'se.promocodie.com',
        locales: [Locale.sv_SE],
      },
      {
        domain: 'uk.promocodie.com',
        locales: [Locale.en_GB],
      },
      {
        domain: 'au.promocodie.com',
        locales: [Locale.en_AU],
      },
      {
        domain: 'at.promocodie.com',
        locales: [Locale.de_AT],
      },
      {
        domain: 'tw.promocodie.com',
        locales: [Locale.zh_TW],
      },
      {
        domain: 'kr.promocodie.com',
        locales: [Locale.ko_KR],
      },
      {
        domain: 'fr.promocodie.com',
        locales: [Locale.fr_FR],
      },
      {
        domain: 'usa.promocodie.com',
        locales: [Locale.en_US],
      },
    ],
    name: path.basename(__filename, path.extname(__filename)),
    // maxStartUrls: 1000, // Uncomment this line to custom the max start URLs of your actor
  },
];
