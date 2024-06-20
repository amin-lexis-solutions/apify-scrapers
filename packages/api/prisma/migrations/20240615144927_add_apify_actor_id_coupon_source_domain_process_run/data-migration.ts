import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Loading data...');

  const sources = await prisma.source.findMany({
    select: {
      id: true,
      name: true,
      apifyActorId: true,
    },
  });

  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: Math.ceil(sources.length),
    width: 40,
  });

  for (const source of sources) {
    try {
      await prisma.sourceDomain.updateMany({
        where: {
          sourceId: source.id,
        },
        data: {
          apifyActorId: source.apifyActorId,
        },
      });

      await prisma.coupon.updateMany({
        where: {
          sourceId: source.id,
        },
        data: {
          apifyActorId: source.apifyActorId,
        },
      });

      await prisma.processedRun.updateMany({
        where: {
          sourceId: source.id,
        },
        data: {
          apifyActorId: source.apifyActorId,
        },
      });
    } catch (e) {
      console.error(`❌ Error processing source ${source.name}: ${e}`);
      continue;
    }
    bar.tick();
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
