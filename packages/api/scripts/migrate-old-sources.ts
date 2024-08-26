/* eslint-disable no-console */
import { prisma } from '../src/lib/prisma';
import { SOURCES_DATA } from '../config/actors';

async function migrateSources() {
  // Initialize stats object
  const stats = {
    sources: {
      total: 0,
      updated: 0,
      deleted: 0,
    },
    domains: {
      total: 0,
      created: 0,
      deleted: 0,
    },
    coupons: {
      updated: 0,
    },
    processedRuns: {
      updated: 0,
    },
  };

  // Filter active sources with a valid Apify actor ID
  const activeSources = SOURCES_DATA.filter(
    (source) => source.apifyActorId !== null
  );

  // Update stats for total active sources
  stats.sources.total = activeSources.length;

  // Extract names of active sources
  const activeSourceIds = activeSources.map((source) => source.apifyActorId);
  const activeSourceNames = activeSources.map((source) => source.name);

  // Retrieve sources from the database matching the active source names
  const existingSources = await prisma.source.findMany({
    where: {
      name: { in: activeSourceNames },
    },
    include: { domains: true },
  });

  // Update stats for sources retrieved from the database
  stats.sources.updated = existingSources.length;

  // Create a map of old to new Apify actor IDs
  const sourceIdMapping = existingSources
    .filter((existingSource) => {
      return activeSources.some(
        (source) =>
          source.name === existingSource.name &&
          source.apifyActorId !== existingSource.apifyActorId
      );
    })
    .map((existingSource) => {
      const correspondingSource = activeSources.find(
        (source) => source.name === existingSource.name
      );
      return {
        oldActorId: existingSource.apifyActorId,
        newActorId: correspondingSource!.apifyActorId,
      };
    });

  // Migrate coupons and processed runs from old actor IDs to new actor IDs
  for (const { oldActorId, newActorId } of sourceIdMapping) {
    const couponUpdateResult = await prisma.coupon.updateMany({
      where: { apifyActorId: oldActorId },
      data: {
        apifyActorId: newActorId,
      },
    });
    stats.coupons.updated += couponUpdateResult.count;

    const processedRunUpdateResult = await prisma.processedRun.updateMany({
      where: { apifyActorId: oldActorId },
      data: { apifyActorId: newActorId },
    });
    stats.processedRuns.updated += processedRunUpdateResult.count;
  }

  // delete sourcesDomains where source is not in activeSources
  const sourceDomainDeleted = await prisma.sourceDomain.deleteMany({
    where: {
      NOT: { apifyActorId: { in: activeSourceIds } },
    },
  });

  stats.domains.deleted += sourceDomainDeleted.count;

  // delete source where source is not in activeSources
  const sourceDeleted = await prisma.source.deleteMany({
    where: {
      NOT: { apifyActorId: { in: activeSourceIds } },
    },
  });

  stats.sources.deleted += sourceDeleted.count;

  // Flatten stats for console.table
  const tableData = [
    { Category: 'Config Active Sources', Count: stats.sources.total },
    { Category: 'DB Related Sources', Count: stats.sources.updated },
    { Category: 'Deleted Sources', Count: stats.sources.deleted },
    { Category: 'Total Domains', Count: stats.domains.total },
    { Category: 'Created Domains', Count: stats.domains.created },
    { Category: 'Deleted Domains', Count: stats.domains.deleted },
    { Category: 'Updated Coupons', Count: stats.coupons.updated },
    { Category: 'Updated Processed Runs', Count: stats.processedRuns.updated },
  ];

  console.log('Migration complete:');
  console.table(tableData);
}

migrateSources()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
