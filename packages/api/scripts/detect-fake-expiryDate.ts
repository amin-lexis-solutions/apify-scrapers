/* eslint-disable max-len */
/* eslint-disable no-console */
import ProgressBar from 'progress';
import { prisma } from '../src/lib/prisma';
import { isExpiryDateMightBeFake } from '../src/utils/utils';
const BATCH_SIZE = 100;

/**
 * Main function to detect fake expiry date
 */
async function detectFakeExpiryDate() {
  console.log('Starting looking for coupons...');

  try {
    const totalCoupons = await prisma.coupon.count({
      where: { expiryDateAt: { not: null }, expiryDateMightBeFake: null },
    });
    console.log(`Total coupons with Expiry Date: ${totalCoupons}`);

    // Fetch results to update in batches
    let offset = 0;
    const progressFetch = new ProgressBar('Fetching [:bar] :percent :etas', {
      total: totalCoupons,
      width: 25,
    });

    const stats = {
      total: totalCoupons,
      detectFakeExpiryDate: 0,
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const coupons = await prisma.coupon.findMany({
        select: {
          id: true,
          expiryDateAt: true,
        },
        where: { expiryDateAt: { not: null }, expiryDateMightBeFake: null },
        skip: offset,
        take: BATCH_SIZE,
      });

      if (coupons.length === 0) break;

      // Update coupons
      for (const coupon of coupons) {
        const expiryDateMightBeFake =
          coupon.expiryDateAt !== null
            ? isExpiryDateMightBeFake(coupon.expiryDateAt)
            : null;
        await prisma.$executeRaw`UPDATE "Coupon" SET "expiryDateMightBeFake" = ${expiryDateMightBeFake} WHERE "id" = ${coupon.id};`;
        if (expiryDateMightBeFake) {
          stats.detectFakeExpiryDate += 1;
        }
      }
      progressFetch.tick(coupons.length);
      offset += BATCH_SIZE; // Increment offset for the next batch
    }

    console.log(
      `Total fake expiry date detected: ${stats.detectFakeExpiryDate}`
    );
  } catch (error) {
    console.error('Operation failed:', error);
  } finally {
    await prisma.$disconnect(); // Ensure the connection is closed
  }
}

// Run the detectFakeExpiryDate function
detectFakeExpiryDate();
