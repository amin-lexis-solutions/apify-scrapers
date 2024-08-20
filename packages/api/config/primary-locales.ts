/* eslint-disable no-console */
import { Locale } from './locales';

interface LocaleEntry {
  locale: Locale;
  countryCode: string;
  languageCode: string;
  searchTemplate: string;
}

const localesToImport: LocaleEntry[] = [
  {
    locale: Locale.cs_CZ,
    countryCode: 'cz',
    languageCode: 'cs',
    searchTemplate: '{{merchant_name}} slevový kód',
  },
  {
    locale: Locale.da_DK,
    countryCode: 'dk',
    languageCode: 'da',
    searchTemplate: '{{merchant_name}} rabatkode',
  },
  {
    locale: Locale.de_AT,
    countryCode: 'at',
    languageCode: 'de',
    searchTemplate: '{{merchant_name}} Gutschein',
  },
  {
    locale: Locale.de_CH,
    countryCode: 'ch',
    languageCode: 'de',
    searchTemplate: '{{merchant_name}} Gutschein',
  },
  {
    locale: Locale.de_DE,
    countryCode: 'de',
    languageCode: 'de',
    searchTemplate: '{{merchant_name}} Gutschein',
  },
  {
    locale: Locale.en_AE,
    countryCode: 'ae',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_HK,
    countryCode: 'hk',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_MY,
    countryCode: 'my',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_AU,
    countryCode: 'au',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_CA,
    countryCode: 'ca',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_GB,
    countryCode: 'gb',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_IE,
    countryCode: 'ie',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_NZ,
    countryCode: 'nz',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_SG,
    countryCode: 'sg',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.en_US,
    countryCode: 'us',
    languageCode: 'en',
    searchTemplate: '{{merchant_name}} discount code',
  },
  {
    locale: Locale.es_AR,
    countryCode: 'ar',
    languageCode: 'es',
    searchTemplate: '{{merchant_name}} código de descuento',
  },
  {
    locale: Locale.es_CO,
    countryCode: 'co',
    languageCode: 'es',
    searchTemplate: '{{merchant_name}} código de descuento',
  },
  {
    locale: Locale.es_ES,
    countryCode: 'es',
    languageCode: 'es',
    searchTemplate: '{{merchant_name}} código de descuento',
  },
  {
    locale: Locale.es_MX,
    countryCode: 'mx',
    languageCode: 'es',
    searchTemplate: '{{merchant_name}} código de descuento',
  },
  {
    locale: Locale.es_CL,
    countryCode: 'cl',
    languageCode: 'es',
    searchTemplate: '{{merchant_name}} código de descuento',
  },
  {
    locale: Locale.fi_FI,
    countryCode: 'fi',
    languageCode: 'fi',
    searchTemplate: '{{merchant_name}} alennuskoodi',
  },
  {
    locale: Locale.fr_BE,
    countryCode: 'be',
    languageCode: 'fr',
    searchTemplate: '{{merchant_name}} code promo',
  },
  {
    locale: Locale.fr_CH,
    countryCode: 'ch',
    languageCode: 'fr',
    searchTemplate: '{{merchant_name}} code promo',
  },
  {
    locale: Locale.fr_FR,
    countryCode: 'fr',
    languageCode: 'fr',
    searchTemplate: '{{merchant_name}} code promo',
  },
  {
    locale: Locale.hu_HU,
    countryCode: 'hu',
    languageCode: 'hu',
    searchTemplate: '{{merchant_name}} kuponkód',
  },
  {
    locale: Locale.it_CH,
    countryCode: 'ch',
    languageCode: 'it',
    searchTemplate: '{{merchant_name}} codice sconto',
  },
  {
    locale: Locale.it_IT,
    countryCode: 'it',
    languageCode: 'it',
    searchTemplate: '{{merchant_name}} codice sconto',
  },
  {
    locale: Locale.ko_KR,
    countryCode: 'kr',
    languageCode: 'ko',
    searchTemplate: '{{merchant_name}} 할인 코드',
  },
  {
    locale: Locale.nb_NO,
    countryCode: 'no',
    languageCode: 'no',
    searchTemplate: '{{merchant_name}} rabattkode',
  },
  {
    locale: Locale.nl_BE,
    countryCode: 'be',
    languageCode: 'nl',
    searchTemplate: '{{merchant_name}} kortingscode',
  },
  {
    locale: Locale.nl_NL,
    countryCode: 'nl',
    languageCode: 'nl',
    searchTemplate: '{{merchant_name}} kortingscode',
  },
  {
    locale: Locale.pl_PL,
    countryCode: 'pl',
    languageCode: 'pl',
    searchTemplate: '{{merchant_name}} kod rabatowy',
  },
  {
    locale: Locale.pt_BR,
    countryCode: 'br',
    languageCode: 'pt-BR',
    searchTemplate: '{{merchant_name}} cupom de desconto',
  },
  {
    locale: Locale.pt_PT,
    countryCode: 'pt',
    languageCode: 'pt-PT',
    searchTemplate: '{{merchant_name}} código de desconto',
  },
  {
    locale: Locale.ro_RO,
    countryCode: 'ro',
    languageCode: 'ro',
    searchTemplate: '{{merchant_name}} cod de reducere',
  },
  {
    locale: Locale.sk_SK,
    countryCode: 'sk',
    languageCode: 'sk',
    searchTemplate: '{{merchant_name}} zľavový kód',
  },
  {
    locale: Locale.sv_SE,
    countryCode: 'se',
    languageCode: 'sv',
    searchTemplate: '{{merchant_name}} rabattkod',
  },
];

function validateUniqueness(data: LocaleEntry[]) {
  const localeSet = new Set();
  const countryLangSet = new Set();

  for (const entry of data) {
    const localeKey = entry.locale;
    const countryLangKey = `${entry.languageCode}_${entry.countryCode}`;

    // Check for locale uniqueness
    if (localeSet.has(localeKey)) {
      throw new Error(`Duplicate locale found: ${localeKey}`);
    }
    localeSet.add(localeKey);

    // Check for country and language code combination uniqueness
    if (countryLangSet.has(countryLangKey)) {
      throw new Error(
        `Duplicate country and language combination found: ${localeKey}`
      );
    }
    countryLangSet.add(countryLangKey);
  }
}

validateUniqueness(localesToImport);

export { localesToImport };
