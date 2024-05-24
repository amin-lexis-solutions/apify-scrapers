import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';

const prisma = new PrismaClient();

async function main() {
  console.log('Start data migration');

  const coupons = await prisma.coupon.findMany({
    include: {
      locale_relation: true,
    },
  });

  const batchSize = 100; // Adjust this value based on your needs
  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: Math.ceil(coupons.length / batchSize),
    width: 40,
  });

  for (let i = 0; i < coupons.length; i += batchSize) {
    const batch = coupons.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map((coupon: any) =>
        prisma.coupon.update({
          where: { id: coupon.id },
          data: {
            locale: coupon.locale_relation.locale,
          },
        })
      )
    );
    bar.tick();
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
