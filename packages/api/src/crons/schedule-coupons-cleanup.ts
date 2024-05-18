import { prisma } from '../lib/prisma';
import dayjs from 'dayjs';

export async function main() {
  // Delete coupons older than 6 weeks
  const olderThan = dayjs().subtract(6, 'weeks').toDate();

  const deleted = await prisma.couponStats.deleteMany({
    where: {
      createdAt: {
        lt: olderThan,
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
