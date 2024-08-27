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

  const sourceUrls = coupons.map((coupon) => coupon.sourceUrl);

  // Step 3: Update coupons in a loop with concurrency control
  const updatePromises = sourceUrls.map(async (sourceUrl) => {
    const [, release] = await semaphore.acquire();
    try {
      const sourceDomain =
        new URL(sourceUrl).hostname.replace('www.', '') || null;
      if (!sourceDomain) throw new Error(`Invalid sourceUrl: ${sourceUrl}`);

      const couponsCount = await prisma.coupon.updateMany({
        where: { sourceUrl },
        data: { sourceDomain },
      });

      batchStats.totalProcessed += couponsCount.count;
    } catch (error) {
      console.error(
        `Error updating coupons for sourceUrl: ${sourceUrl}`,
        error
      );
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
        distinct: ['sourceUrl'],
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
