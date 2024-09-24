/* eslint-disable max-len */
/* eslint-disable no-console */
import ProgressBar from 'progress';
import { prisma } from '../src/lib/prisma';

const BATCH_SIZE = 1000;

/**
 * Filters out undefined values from an object.
 * @param data - The object to filter.
 * @returns A new object with only defined values.
 */
function filterUndefinedValues(data: any) {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  );
}

/**
 * Processes items in batches, updating the database.
 * @param items - The items to process.
 * @param batchSize - The size of each batch.
 * @param progressBar - The progress bar for tracking progress.
 */
async function processInBatches(
  items: any[],
  batchSize: number,
  progressBar: ProgressBar
) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const updatePromises = batch.map(async (item: any) => {
      try {
        const updateData = filterUndefinedValues({
          id: item.hash_value,
          idInSite: item.idInSite,
          title: item.title,
          description: item.description,
          termsAndConditions: item.termsAndConditions,
          code: item.code,
          shouldBeFake: item.shouldBeFake,
          isExpired: item.isExpired,
          isShown: item.isShown,
          isExclusive: item.isExclusive,
          archivedReason: item.archivedReason,
          archivedAt: item.archivedAt,
          expiryDateAt: item.expiryDateAt,
          startDateAt: item.startDateAt,
          firstSeenAt: item.firstSeenAt,
          lastSeenAt: item.lastSeenAt,
          lastCrawledAt: item.lastCrawledAt,
        });
        // Update existing coupons based on IDs
        return prisma.coupon.updateMany({
          where: {
            id: {
              in: item.ids,
            },
          },
          data: updateData,
        });
      } catch (error) {
        // Log the error and continue
        console.error(`Error updating coupon with IDs ${item.ids}:`, error);
        return null; // Return null or handle as needed
      }
    });

    await Promise.all(updatePromises);
    progressBar.tick(batch.length);
  }
}

/**
 * Main function to migrate coupon IDs.
 */
async function migrateCouponsId() {
  console.log('Starting migration...');

  // Ensure the database connection is established
  await prisma.$connect();

  try {
    // Enable the pgcrypto extension
    await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS pgcrypto;`;

    // Create necessary functions
    await prisma.$executeRaw`
      CREATE OR REPLACE FUNCTION normalize_string(input TEXT) RETURNS TEXT AS $$
      BEGIN
        RETURN lower(trim(input));
      END;
      $$ LANGUAGE plpgsql;
    `;

    await prisma.$executeRaw`
      CREATE OR REPLACE FUNCTION generate_hash(merchant_name TEXT, item_identifier TEXT, locale TEXT, source_url TEXT) RETURNS TEXT AS $$
      DECLARE
        normalized_merchant TEXT;
        normalized_identifier TEXT;
        normalized_locale TEXT;
        normalized_url TEXT;
        combined_string TEXT;
        hash TEXT;
      BEGIN
        normalized_merchant := normalize_string(merchant_name);
        normalized_identifier := normalize_string(item_identifier);
        normalized_locale := normalize_string(locale);
        normalized_url := normalize_string(source_url);

        combined_string := normalized_merchant || '|' || normalized_identifier || '|' || normalized_locale || '|' || normalized_url;

        hash := encode(digest(combined_string, 'sha256'), 'hex');
        RETURN hash;
      END;
      $$ LANGUAGE plpgsql;
    `;

    // Create indexes for performance
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_coupon_merchant ON "Coupon" ("merchantNameOnSite");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_coupon_idInSite ON "Coupon" ("idInSite");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_coupon_title ON "Coupon" ("title");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_coupon_locale ON "Coupon" ("locale");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_coupon_source_url ON "Coupon" ("sourceUrl");`;

    // Drop the temporary table if it already exists
    await prisma.$executeRaw`DROP TABLE IF EXISTS temp_coupon;`;

    // Create the temporary table
    await prisma.$executeRaw`
      CREATE TEMP TABLE temp_coupon AS
      SELECT
          COUNT(id) AS duplicate_count,
          generate_hash("merchantNameOnSite", COALESCE("idInSite", "title"), "locale", "sourceUrl") AS hash_value,
          json_agg("title"::text) AS "object_titles",
          json_agg("id"::text) AS "object_ids",
          json_agg("description"::text) AS "object_descriptions",
          json_agg("termsAndConditions"::text) AS "object_terms",
          json_agg("archivedReason"::text) AS "object_reasons",
          json_agg("code"::text) AS "object_codes",
          json_agg("shouldBeFake"::boolean) AS "object_fakes",
          json_agg("isExpired"::boolean) AS "object_isExpired",
          json_agg("isShown"::boolean) AS "object_isShown",
          json_agg("isExclusive"::boolean) AS "object_isExclusive",
          json_agg(TO_CHAR("archivedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS "object_archivedAt",
          MAX(TO_CHAR("expiryDateAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS "expiryDateAt",
          MAX(TO_CHAR("startDateAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS "startDateAt",
          GREATEST(MAX("isExclusive"::int)::boolean) AS "isExclusive",
          MIN(TO_CHAR("firstSeenAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS "firstSeenAt",
          MAX(TO_CHAR("lastSeenAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS "lastSeenAt",
          MAX(TO_CHAR("lastCrawledAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS "lastCrawledAt"
      FROM
          "Coupon"
      GROUP BY
          "hash_value"
    `;

    // Count the number of coupons in the temporary table
    const countCoupons: any = await prisma.$queryRaw`
      SELECT COUNT(*) AS coupons FROM temp_coupon;
    `;
    const totalCoupons = parseInt(countCoupons?.[0]?.coupons || '0', 10);

    // Fetch results to delete
    const resultsToDelete: any = await prisma.$queryRaw`
      SELECT object_ids, duplicate_count FROM temp_coupon WHERE duplicate_count > 1;
    `;

    console.log('Coupons to update and delete:');
    console.table([
      { Action: 'Update', Count: totalCoupons },
      { Action: 'Delete', Count: resultsToDelete.length },
    ]);

    // Fetch results to update in batches
    let offset = 0;
    const couponsToUpdate: any[] = [];
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

      couponsToUpdate.push(...coupons);
      progressFetch.tick(coupons.length);
      offset += BATCH_SIZE; // Increment offset for the next batch
    }

    // Prepare IDs to delete
    const idsToDelete: string[] = [];
    resultsToDelete.forEach((result: any) => {
      if (result.object_ids) {
        idsToDelete.push(...result.object_ids.slice(1)); // Keep all but the first ID
      }
    });

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

    // Prepare items for updating
    const progressUpdate = new ProgressBar('Updating [:bar] :percent :etas', {
      total: totalCoupons,
      width: 25,
    });

    // Prepare items for updating
    const items = couponsToUpdate.map((result: any) => ({
      ids: result?.object_ids,
      title: result?.object_idInSites?.[0],
      description: result?.object_idInSites?.[0],
      termsAndConditions: result?.object_idInSites?.[0],
      code: result?.object_codes?.[0],
      shouldBeFake: result?.object_fakes?.[0],
      isExpired: result?.object_isExpired?.[0],
      isShown: result?.object_isShown?.[0],
      isExclusive: result?.object_isExclusive?.[0],
      archivedReason: result?.object_reasons?.[0],
      archivedAt: result?.object_archivedAt?.[0]
        ? new Date(result?.object_archivedAt?.[0])
        : null,
      expiryDateAt: result.expiryDateAt,
      startDateAt: result.startDateAt,
      firstSeenAt: result.firstSeenAt,
      lastSeenAt: result.lastSeenAt,
      lastCrawledAt: result.lastCrawledAt,
      hash_value: result.hash_value,
    }));

    await processInBatches(items, 5, progressUpdate);

    // Drop the temporary table
    await prisma.$executeRaw`DROP TABLE IF EXISTS temp_coupon;`;

    // Drop the functions
    await prisma.$executeRaw`DROP FUNCTION IF EXISTS normalize_string(TEXT);`;
    await prisma.$executeRaw`DROP FUNCTION IF EXISTS generate_hash(TEXT, TEXT, TEXT, TEXT);`;

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect(); // Ensure the connection is closed
  }
}

// Execute the migration
migrateCouponsId();
