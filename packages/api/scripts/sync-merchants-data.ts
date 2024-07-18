/* eslint-disable no-console */
import { prisma } from '../src/lib/prisma';
import { getMerchantsForLocale } from '@api/lib/oberst-api';

async function handleMerchants(locale: string) {
  const existingMerchants = await prisma.merchant.findMany({
    where: {
      locale_relation: {
        locale: locale,
      },
    },
  });

  console.log(
    `Total existing merchants ${existingMerchants.length} - locale ${locale}`
  );

  const existingMerchantNames = new Set(existingMerchants.map((m) => m.name));

  const merchantsData = await getMerchantsForLocale(locale);

  for (const merchant of merchantsData) {
    await prisma.merchant.upsert({
      where: {
        locale_oberst_id: {
          locale: locale,
          oberst_id: merchant.id,
        },
      },
      update: {
        disabledAt: null,
        updatedAt: new Date(),
      },
      create: {
        name: merchant.name,
        domain: merchant.domain,
        locale,
        oberst_id: merchant.id,
      },
    });
    existingMerchantNames.delete(merchant.name);
  }

  await prisma.merchant.updateMany({
    where: {
      locale,
      disabledAt: null,
      name: {
        in: Array.from(existingMerchantNames),
      },
    },
    data: {
      disabledAt: new Date(),
    },
  });
}

async function main() {
  const locales = await prisma.targetLocale.findMany({
    where: {
      isActive: true,
    },
    select: {
      locale: true,
    },
  });

  console.log(`Total locales ${locales.length}`);

  for (const { locale } of locales) {
    await handleMerchants(locale);
  }
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
