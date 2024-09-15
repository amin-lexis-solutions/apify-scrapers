/* eslint-disable no-console */
/* eslint-disable no-constant-condition */
import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';
import dotenv from 'dotenv';
import { Semaphore } from 'async-mutex';
import { exit } from 'process';

dotenv.config();

const prisma = new PrismaClient();
const BATCH_SIZE = 1000;
const MAX_CONCURRENT_CONNECTIONS = 5;
const semaphore = new Semaphore(MAX_CONCURRENT_CONNECTIONS);

interface CouponUpdateStats {
  totalProcessed: number;
}

const initialStats: CouponUpdateStats = {
  totalProcessed: 0,
};

const updateCouponsBatch = async (
  coupons: any[]
): Promise<CouponUpdateStats> => {
  const batchStats: CouponUpdateStats = { ...initialStats };

  // Step 1: Fetch all targetPage records
  const sourceUrls = coupons.map((coupon) => coupon.sourceUrl);
  const targetPages = await prisma.targetPage.findMany({
    where: { url: { in: sourceUrls } },
    include: { merchant: true },
  });

  // Step 2: Create a Map for fast lookup
  const targetPageMap = new Map(targetPages.map((tp) => [tp.url, tp]));

  // Step 3: Update coupons in a loop with concurrency control
  const updatePromises = coupons.map(async (coupon) => {
    const [, release] = await semaphore.acquire();
    try {
      const targetPage = targetPageMap.get(coupon.sourceUrl);

      if (targetPage?.merchant) {
        const couponsCount = await prisma.coupon.updateMany({
          where: { sourceUrl: coupon.sourceUrl },
          data: {
            merchantId: targetPage.merchant.id,
            locale: targetPage.merchant.locale || coupon.locale,
            merchantNameOnSite:
              targetPage.merchant.name || coupon.merchantNameOnSite,
            domain: targetPage.merchant.domain || coupon.domain,
          },
        });

        batchStats.totalProcessed += couponsCount.count;
      }
    } finally {
      release();
    }
  });

  await Promise.all(updatePromises);

  return batchStats;
};

const main = async () => {
  try {
    let startFrom = 0;
    const totalCoupons = await prisma.coupon
      .findMany({
        distinct: ['sourceUrl'],
      })
      .then((coupons) => coupons.length);
    console.log(`Total unique source to update: ${totalCoupons}`);
    const bar = new ProgressBar('Processing [:bar] :percent :etas', {
      total: Math.ceil(totalCoupons / BATCH_SIZE),
      width: 25,
    });

    const cumulativeStats: CouponUpdateStats = { ...initialStats };

    while (true) {
      const coupons = await prisma.coupon.findMany({
        take: BATCH_SIZE,
        skip: startFrom,
        orderBy: { id: 'asc' },
        include: { locale_relation: true },
      });

      if (coupons.length === 0) {
        console.log('No more coupons to update.');
        break;
      }

      const batchStats = await updateCouponsBatch(coupons);
      for (const key in batchStats) {
        cumulativeStats[key as keyof CouponUpdateStats] +=
          batchStats[key as keyof CouponUpdateStats];
      }

      bar.tick();
      startFrom += BATCH_SIZE;
      // if bar is complete, break the loop
      if (bar.complete) break;
    }

    console.log('All coupons processed. Displaying update statistics:');
    console.table(cumulativeStats);
  } catch (error) {
    console.error('Error updating coupons:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    exit(0);
  }
};

main();
