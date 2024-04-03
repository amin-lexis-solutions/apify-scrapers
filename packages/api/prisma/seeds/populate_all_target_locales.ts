import { prisma } from '../../src/lib/prisma';

const localesToImport = [
  'cs_CZ',
  'da_DK',
  'de_AT',
  'de_CH',
  'de_DE',
  'en_AE',
  'en_AU',
  'en_CA',
  'en_GB',
  'en_IE',
  'en_NZ',
  'en_SG',
  'en_US',
  'es_AR',
  'es_CO',
  'es_ES',
  'es_MX',
  'fi_FI',
  'fr_BE',
  'fr_CH',
  'fr_FR',
  'hu_HU',
  'it_CH',
  'it_IT',
  'ko_KR',
  'nb_NO',
  'nl_BE',
  'nl_NL',
  'pl_PL',
  'pt_BR',
  'pt_PT',
  'ro_RO',
  'sk_SK',
  'sv_SE',
];

async function main() {
  for (const locale of localesToImport) {
    const [languageCode, countryCode] = locale.split('_');
    const searchTemplate = '{{website}} coupon codes'; // Default search template
    const isActive = false; // Default to false

    const exists = await prisma.targetLocale.findFirst({
      where: {
        locale,
        countryCode,
        languageCode,
      },
    });

    if (exists) {
      console.log(`Locale already exists: ${locale}`);
      continue;
    }
    await prisma.targetLocale.create({
      data: {
        locale,
        countryCode,
        languageCode,
        searchTemplate,
        isActive,
      },
    });
    console.log(`Imported locale: ${locale}`);
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
