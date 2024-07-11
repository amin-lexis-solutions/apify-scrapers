import { prisma } from '../../src/lib/prisma';
import { localesToImport } from '../../config/primary-locales';

async function main() {
  for (const {
    locale,
    countryCode,
    languageCode,
    searchTemplate,
  } of localesToImport) {
    try {
      await prisma.targetLocale.upsert({
        where: { locale: locale },
        update: {
          countryCode,
          languageCode,
          searchTemplate,
        },
        create: {
          locale,
          countryCode,
          languageCode,
          searchTemplate,
          isActive: false,
        },
      });
      console.log(`🌱 Seeded target locale ${locale}`);
    } catch (e) {
      console.error(e);
    }
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
