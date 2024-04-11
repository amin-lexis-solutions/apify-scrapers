import { prisma } from '../../src/lib/prisma';

const localesToImport = [
  {
    locale: 'cs_CZ',
    countryCode: 'cz',
    languageCode: 'cs',
    searchTemplate: '{{website}} slevový kód',
  },
  {
    locale: 'da_DK',
    countryCode: 'dk',
    languageCode: 'da',
    searchTemplate: '{{website}} rabatkode',
  },
  {
    locale: 'de_AT',
    countryCode: 'at',
    languageCode: 'de',
    searchTemplate: '{{website}} Gutschein',
  },
  {
    locale: 'de_CH',
    countryCode: 'ch',
    languageCode: 'de',
    searchTemplate: '{{website}} Gutschein',
  },
  {
    locale: 'de_DE',
    countryCode: 'de',
    languageCode: 'de',
    searchTemplate: '{{website}} Gutschein',
  },
  {
    locale: 'en_AE',
    countryCode: 'ae',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_HK',
    countryCode: 'hk',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_MY',
    countryCode: 'my',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_AU',
    countryCode: 'en',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_CA',
    countryCode: 'ca',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_GB',
    countryCode: 'gb',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_IE',
    countryCode: 'ie',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_NZ',
    countryCode: 'nz',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_SG',
    countryCode: 'sg',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'en_US',
    countryCode: 'us',
    languageCode: 'en',
    searchTemplate: '{{website}} discount code',
  },
  {
    locale: 'es_AR',
    countryCode: 'ar',
    languageCode: 'es',
    searchTemplate: '{{website}} código de descuento',
  },
  {
    locale: 'es_CO',
    countryCode: 'co',
    languageCode: 'es',
    searchTemplate: '{{website}} código de descuento',
  },
  {
    locale: 'es_ES',
    countryCode: 'es',
    languageCode: 'es',
    searchTemplate: '{{website}} código de descuento',
  },
  {
    locale: 'es_MX',
    countryCode: 'mx',
    languageCode: 'es',
    searchTemplate: '{{website}} código de descuento',
  },
  {
    locale: 'es_CL',
    countryCode: 'mx',
    languageCode: 'es',
    searchTemplate: '{{website}} código de descuento',
  },
  {
    locale: 'fi_FI',
    countryCode: 'fi',
    languageCode: 'fi',
    searchTemplate: '{{website}} alennuskoodi',
  },
  {
    locale: 'fr_BE',
    countryCode: 'be',
    languageCode: 'fr',
    searchTemplate: '{{website}} code promo',
  },
  {
    locale: 'fr_CH',
    countryCode: 'ch',
    languageCode: 'fr',
    searchTemplate: '{{website}} code promo',
  },
  {
    locale: 'fr_FR',
    countryCode: 'fr',
    languageCode: 'fr',
    searchTemplate: '{{website}} code promo',
  },
  {
    locale: 'hu_HU',
    countryCode: 'hu',
    languageCode: 'hu',
    searchTemplate: '{{website}} kuponkód',
  },
  {
    locale: 'it_CH',
    countryCode: 'ch',
    languageCode: 'it',
    searchTemplate: '{{website}} codice sconto',
  },
  {
    locale: 'it_IT',
    countryCode: 'it',
    languageCode: 'it',
    searchTemplate: '{{website}} codice sconto',
  },
  {
    locale: 'ko_KR',
    countryCode: 'kr',
    languageCode: 'ko',
    searchTemplate: '{{website}} 할인 코드',
  },
  {
    locale: 'nb_NO',
    countryCode: 'no',
    languageCode: 'no',
    searchTemplate: '{{website}} rabattkode',
  },
  {
    locale: 'nl_BE',
    countryCode: 'be',
    languageCode: 'nl',
    searchTemplate: '{{website}} kortingscode',
  },
  {
    locale: 'nl_NL',
    countryCode: 'nl',
    languageCode: 'nl',
    searchTemplate: '{{website}} kortingscode',
  },
  {
    locale: 'pl_PL',
    countryCode: 'pl',
    languageCode: 'pl',
    searchTemplate: '{{website}} kod rabatowy',
  },
  {
    locale: 'pt_BR',
    countryCode: 'br',
    languageCode: 'pt-BR',
    searchTemplate: '{{website}} cupom de desconto',
  },
  {
    locale: 'pt_PT',
    countryCode: 'pt',
    languageCode: 'pt-PT',
    searchTemplate: '{{website}} código de desconto',
  },
  {
    locale: 'ro_RO',
    countryCode: 'ro',
    languageCode: 'ro',
    searchTemplate: '{{website}} cod de reducere',
  },
  {
    locale: 'sk_SK',
    countryCode: 'sk',
    languageCode: 'sk',
    searchTemplate: '{{website}} zľavový kód',
  },
  {
    locale: 'sv_SE',
    countryCode: 'se',
    languageCode: 'sv',
    searchTemplate: '{{website}} rabattkod',
  },
];

async function main() {
  for (const {
    locale,
    countryCode,
    languageCode,
    searchTemplate,
  } of localesToImport) {
    await prisma.targetLocale.upsert({
      where: { locale: locale },
      create: {
        locale,
        countryCode,
        languageCode,
        searchTemplate,
        isActive: false,
      },
      update: {
        countryCode,
        languageCode,
        searchTemplate,
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
