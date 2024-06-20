import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';
import { isValidCouponCode } from '../../src/utils/utils';

const prisma = new PrismaClient();
const BATCH_SIZE = 1000;

async function main() {
  console.log('🚀 Flagging fake coupon codes...');
  // Count the total number of coupons matching the criteria
  const totalCoupons = await prisma.coupon.count({
    where: {
      code: {
        not: null,
      },
      shouldBeFake: {
        equals: null,
      },
    },
  });

  console.log(`🔍 Found ${totalCoupons} coupons with a code`);

  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: totalCoupons,
    width: 40,
  });

  let processedCount = 0;

  while (processedCount < totalCoupons) {
    // Fetch a batch of coupons
    const coupons = await prisma.coupon.findMany({
      select: {
        id: true,
        code: true,
      },
      where: {
        code: {
          not: null,
        },
        shouldBeFake: {
          equals: null,
        },
      },
      take: BATCH_SIZE,
    });

    for (const coupon of coupons) {
      try {
        // Update the coupon code
        await prisma.coupon.update({
          where: {
            id: coupon.id,
          },
          data: {
            shouldBeFake: !isValidCouponCode(coupon.code ?? ''),
          },
        });
        bar.tick();
      } catch (e) {
        console.error(`❌ Error processing coupon ${coupon.id}: ${e}`);
      }
    }

    processedCount += coupons.length;
  }

  console.log('✅ Done!');
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
