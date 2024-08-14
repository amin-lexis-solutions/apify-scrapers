/* eslint-disable no-console */
import ProgressBar from 'progress';
import { prisma } from '../src/lib/prisma';
import { fetchMerchantByLocale } from '@api/lib/oberst-api';

async function handleMerchants(locale: string) {
  try {
    const merchantsData = await fetchMerchantByLocale(locale);

    const merchantIdsFromAPI = new Set(merchantsData.map((m) => m.id));

    // Disable merchants not present in the fetched data
    await prisma.merchant.updateMany({
      where: {
        locale: locale,
        oberst_id: {
          notIn: Array.from(merchantIdsFromAPI),
        },
        disabledAt: null,
      },
      data: { disabledAt: new Date() },
    });

    // Re-enable or create merchants based on fetched data
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
    }

    // Calculate stats after update
    const totalMerchants = await prisma.merchant.count({
      where: { locale },
    });

    const totalActiveMerchants = await prisma.merchant.count({
      where: {
        locale,
        disabledAt: null,
      },
    });

    return {
      locale,
      totalMerchants: totalMerchants,
      active: totalActiveMerchants,
      disabled: totalMerchants - totalActiveMerchants,
    };
  } catch (error) {
    return {
      locale,
      error: `Processing failed: ${error}`,
    };
  }
}

async function main() {
  const locales = await prisma.targetLocale.findMany({
    where: { isActive: true },
    select: { locale: true },
  });

  const progressBar = new ProgressBar(
    'Processing :current/:total [:bar] :percent :etas',
    {
      total: locales.length,
    }
  );

  const stats = [];
  for (const { locale } of locales) {
    const results = await handleMerchants(locale);
    stats.push(results);
    progressBar.tick();
  }

  const { totalMerchants, activeMerchants, disabledMerchants } = stats.reduce(
    (acc, curr) => {
      acc.totalMerchants += curr.totalMerchants || 0;
      acc.activeMerchants += curr?.active || 0;
      acc.disabledMerchants += curr?.disabled || 0;
      return acc;
    },
    { totalMerchants: 0, activeMerchants: 0, disabledMerchants: 0 }
  );

  stats.push({
    locale: 'Total',
    totalMerchants,
    active: activeMerchants,
    disabled: disabledMerchants,
  });

  console.table(stats);
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
