import { prisma } from '../../src/lib/prisma';
import { localesToImport } from '../../config/primary-locales';

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
