/* eslint-disable no-console */
/* eslint-disable no-constant-condition */
import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';
import dotenv from 'dotenv';
import { exit } from 'process';
import { SOURCES_DATA } from '../config/actors';

dotenv.config();

type CouponUpdateStats = {
  total: number;
  updated: number;
  failed: any[];
  skipped: any[];
};

const prisma = new PrismaClient();
const cumulativeStats: CouponUpdateStats = {
  total: 0,
  updated: 0,
  failed: [],
  skipped: [],
};

const main = async () => {
  try {
    // get all locales from the targetlocales

    const locales = await prisma.targetLocale.findMany({
      select: {
        locale: true,
      },
    });

    // Update coupons with the first locale from the list of locales for each domain
    const domains = SOURCES_DATA.flatMap((source) => source.domains);
    const bar = new ProgressBar('Processing [:bar] :percent :etas', {
      total: domains.length,
      width: 25,
    });

    for (const domain of domains) {
      try {
        const domainsActiveLocales = domain.locales.filter((locale: any) =>
          locales.some((l) => l.locale === locale)
        );
        if (
          !domain.locales ||
          domain.locales.length === 0 ||
          domainsActiveLocales.length === 0
        ) {
          cumulativeStats.skipped.push({
            domain: domain.domain,
            locales: domain.locales,
            warning: 'No active locales found for domain',
          });
          bar.tick();
          continue;
        }
        const coupons = await prisma.coupon.updateMany({
          where: {
            sourceDomain: domain.domain,
            locale: {
              notIn: domainsActiveLocales,
            },
          },
          data: {
            locale: domainsActiveLocales[0],
          },
        });
        cumulativeStats.total += coupons.count;
        cumulativeStats.updated += coupons.count;
      } catch (error) {
        cumulativeStats.failed.push({
          domain: domain.domain,
          locales: domain.locales,
          error: 'Error updating coupons for domain:',
        });
      }
      bar.tick();
    }

    console.log(`All coupons processed for ${domains.length} domains:`);
    console.table({
      ...cumulativeStats,
      skipped: cumulativeStats.skipped.length,
      failed: cumulativeStats.failed.length,
    });
    console.error('Failed:', cumulativeStats.failed);
    // console.warn('Skipped:', cumulativeStats.skipped);
  } catch (error) {
    console.error('Error updating coupons:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    exit(0);
  }
};

main();
