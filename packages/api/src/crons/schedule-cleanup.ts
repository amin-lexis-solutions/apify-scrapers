import { prisma } from '../../src/lib/prisma';
import dayjs from 'dayjs';

export async function main() {
  const thirtyDaysAgo = dayjs().subtract(30, 'days').toDate();

  const deleted = await prisma.couponStats.deleteMany({
    where: {
      createdAt: {
        lt: thirtyDaysAgo,
      },
    },
  });

  console.log(`Deleted ${deleted.count} coupons older than 30 days`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
