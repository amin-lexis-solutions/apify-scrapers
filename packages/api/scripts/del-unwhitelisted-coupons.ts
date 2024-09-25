/* eslint-disable max-len */
/* eslint-disable no-console */
import ProgressBar from 'progress';
import { prisma } from '../src/lib/prisma';
import { isValidLocaleForDomain } from '../src/utils/utils';
const BATCH_SIZE = 100;

/**
 * Main function to migrate coupon IDs.
 */
async function migrateCouponsId() {
  console.log('Starting looking for unwhitelisted coupons...');

  // Ensure the database connection is established
  await prisma.$connect();

  try {
    // Drop the temporary table if it already exists
    await prisma.$executeRaw`DROP TABLE IF EXISTS temp_coupon;`;

    // Create the temporary table
    await prisma.$executeRaw`
      CREATE TEMP TABLE temp_coupon AS
      SELECT
          json_agg("id"::text) AS "object_ids",
          "sourceDomain", locale
      FROM
          "Coupon"
      GROUP BY
          "sourceDomain" , locale
    `;

    // Count the number of coupons in the temporary table
    const countCoupons: any = await prisma.$queryRaw`
      SELECT COUNT(*) AS coupons FROM temp_coupon;
    `;
    const totalCoupons = parseInt(countCoupons?.[0]?.coupons || '0', 10);

    // Fetch results to update in batches
    let offset = 0;
    const resultsToDelete: any[] = [];
    const progressFetch = new ProgressBar('Fetching [:bar] :percent :etas', {
      total: totalCoupons,
      width: 25,
    });

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const coupons: any = await prisma.$queryRaw`
        SELECT * FROM temp_coupon
        LIMIT ${BATCH_SIZE} OFFSET ${offset};
      `;

      if (coupons.length === 0) break; // Exit loop if no more results

      resultsToDelete.push(...coupons);
      progressFetch.tick(coupons.length);
      offset += BATCH_SIZE; // Increment offset for the next batch
    }

    // Prepare IDs to delete
    const idsToDelete: string[] = [];
    resultsToDelete.forEach((result: any) => {
      if (
        result.object_ids &&
        !isValidLocaleForDomain(result.sourceDomain, result.locale)
      ) {
        idsToDelete.push(...result.object_ids);
      }
    });

    console.log(`Found ${idsToDelete.length} coupons to delete.`);
    // Deleting in batches
    const progressDel = new ProgressBar('Deleting [:bar] :percent :etas', {
      total: idsToDelete.length,
      width: 25,
    });

    for (
      let processed = 0;
      processed < idsToDelete.length;
      processed += BATCH_SIZE
    ) {
      const batch = idsToDelete.slice(processed, processed + BATCH_SIZE);
      const deleted = await prisma.coupon.deleteMany({
        where: {
          id: {
            in: batch,
          },
        },
      });
      progressDel.tick(deleted.count);
    }

    // Drop the temporary table
    await prisma.$executeRaw`DROP TABLE IF EXISTS temp_coupon;`;

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect(); // Ensure the connection is closed
  }
}

// Execute the migration
migrateCouponsId();
