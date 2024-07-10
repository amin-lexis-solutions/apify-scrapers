/* eslint-disable no-console */
import { prisma } from '../src/lib/prisma';
import dayjs from 'dayjs';
import { availableActorRuns } from '../src/utils/utils';
import { runActors } from '../src/crons/schedule-actors';
import ProgressBar from 'progress';
// Retrieve arguments from the command line
const args = process.argv.slice(2);

// Function to update the last run date for various entities in the database
const setLastRunAt = async (date: Date | null) => {
  // Update lastSerpRunAt for targetLocale
  await prisma.targetLocale.updateMany({
    data: { lastSerpRunAt: date?.toISOString() || null },
  });

  // Update lastApifyRunAt for targetPage
  await prisma.targetPage.updateMany({
    data: { lastApifyRunAt: date?.toISOString() || null },
  });

  // Update lastRunAt for source
  await prisma.source.updateMany({
    data: { lastRunAt: date?.toISOString() || null },
  });
};

const testRunActors = async (date: Date) => {
  console.log('Running actors');
  // find all source lastRunAt null isActive true and lastRunAt > today
  let sources = await prisma.source.findMany({
    where: {
      isActive: true,
      lastRunAt: {
        lt: dayjs().toISOString(),
      },
    },
  });

  // ProgressBar to show progress
  const bar = new ProgressBar(':bar :current/:total :percent :etas', {
    total: sources.length,
  });

  console.log(`Total sources to run: ${sources.length}`);

  while (sources.length > 0 && !bar.complete) {
    await runActors();
    // wait until availableActorRuns is greater than 0
    let maxConcurrency = await availableActorRuns();
    while (maxConcurrency < 1) {
      maxConcurrency = await availableActorRuns();
      // sleep for 2 minute
      await new Promise((resolve) => setTimeout(resolve, 120000));
    }
    sources = await prisma.source.findMany({
      where: {
        isActive: true,
        lastRunAt: {
          equals: null,
          gt: new Date(),
        },
      },
    });
    bar.tick();
  }

  // get total off targetPages Scraped today
  const targetPages = await prisma.targetPage.findMany({
    where: {
      lastApifyRunAt: {
        gt: date?.toISOString(),
      },
    },
  });

  console.log(`Total targetPages scraped today: ${targetPages.length}`);
};

// Main function to process command line arguments and execute the script
const main = async () => {
  switch (args[0]) {
    case 'reset': {
      await setLastRunAt(null);
      const now = dayjs().toDate();
      await testRunActors(now);
      console.log('Reset cron job completed');
      break;
    }
    case 'daily': {
      // Set the last run dates to one day ago
      const lastDay = dayjs().subtract(1, 'day').toDate();
      await setLastRunAt(lastDay);
      await testRunActors(lastDay);
      console.log('Daily cron job completed');
      break;
    }
    case 'weekly': {
      // Set the last run dates to one week ago
      const lastWeek = dayjs().subtract(1, 'week').toDate();
      await setLastRunAt(lastWeek);
      await testRunActors(lastWeek);
      console.log('Weekly cron job completed');
      break;
    }
    case 'bi-weekly': {
      // Set the last run dates to one week ago
      const lastWeek = dayjs().subtract(2, 'week').toDate();
      await setLastRunAt(lastWeek);
      await testRunActors(lastWeek);
      console.log('Weekly cron job completed');
      break;
    }
    default:
      console.error('Invalid argument');
      break;
  }
};

// Run the main function and handle any errors
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
