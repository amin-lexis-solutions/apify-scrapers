/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';

const prisma = new PrismaClient();

const apifyActorIds: any = [];

const migrateApifyActorIds = async () => {
  console.log('🚀 Migrating Apify Actor IDs...');
  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: apifyActorIds.length,
    width: 40,
  });

  for (const { old, new: updated } of apifyActorIds) {
    await prisma.coupon.updateMany({
      where: {
        apifyActorId: old,
      },
      data: {
        apifyActorId: updated,
      },
    });

    await prisma.processedRun.updateMany({
      where: {
        apifyActorId: old,
      },
      data: {
        apifyActorId: updated,
      },
    });

    bar.tick();
  }
};

const cleanup = async () => {
  console.log('🚀 Cleaning up...');
  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: apifyActorIds.length,
    width: 40,
  });

  for (const { old } of apifyActorIds) {
    await prisma.source.deleteMany({
      where: {
        apifyActorId: old,
      },
    });
    bar.tick();
  }
};

async function main(args: string[]) {
  switch (args[0]) {
    case 'migrate':
      await migrateApifyActorIds();
      break;
    case 'cleanup':
      await cleanup();
      break;
    default:
      console.error('Invalid argument');
      break;
  }

  console.log('✅ Done!');
}

// get arguments from command line
const args = process.argv.slice(2);
main(args)
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
