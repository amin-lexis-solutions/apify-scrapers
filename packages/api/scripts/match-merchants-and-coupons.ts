/* eslint-disable no-console */
/* eslint-disable no-constant-condition */
import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const BATCH_SIZE = 5000;

interface CouponUpdateStats {
  totalProcessed: number;
  localeFixed: number;
  merchantFixed: number;
  domainFixed: number;
  merchantIdLinked: number;
}

const initialStats: CouponUpdateStats = {
  totalProcessed: 0,
  localeFixed: 0,
  merchantFixed: 0,
  domainFixed: 0,
  merchantIdLinked: 0,
};

const updateCouponsBatch = async (
  coupons: any[]
): Promise<CouponUpdateStats> => {
  const batchStats: CouponUpdateStats = { ...initialStats };

  for (const coupon of coupons) {
    const targetPage = await prisma.targetPage.findFirst({
      where: { url: coupon.sourceUrl },
      include: { merchant: true },
    });

    if (targetPage?.merchant) {
      const updatedCoupon = await prisma.coupon.update({
        where: { id: coupon.id },
        data: {
          merchantId: targetPage.merchant.id,
          locale: targetPage.merchant.locale || coupon.locale,
          merchantName: targetPage.merchant.name || coupon.merchantName,
          domain: targetPage.merchant.domain || coupon.domain,
        },
      });

      // Increment stats based on the changes made
      if (updatedCoupon.locale !== coupon.locale) batchStats.localeFixed++;
      if (updatedCoupon.merchantName !== coupon.merchantName)
        batchStats.merchantFixed++;
      if (updatedCoupon.domain !== coupon.domain) batchStats.domainFixed++;
      if (updatedCoupon.merchantId) batchStats.merchantIdLinked++;
      batchStats.totalProcessed++;
    }
  }

  return batchStats;
};

const main = async () => {
  try {
    let startFrom = 0;
    const totalCoupons = await prisma.coupon.count();
    console.log(`Total coupons to update: ${totalCoupons}`);
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
    }

    console.log('All coupons processed. Displaying update statistics:');
    console.table(cumulativeStats);
  } catch (error) {
    console.error('Error updating coupons:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

main();
