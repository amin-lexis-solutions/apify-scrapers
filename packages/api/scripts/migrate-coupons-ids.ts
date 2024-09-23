/* eslint-disable max-len */
/* eslint-disable no-console */
import ProgressBar from 'progress';
import { prisma } from '../src/lib/prisma';

async function migrateCouponsId() {
  console.log('Starting migration...');
  const progressBar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: 5,
    width: 25,
  });
  // Enable the pgcrypto extension
  await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS pgcrypto;`;
  // Create the normalize_string function
  await prisma.$executeRaw`
      CREATE OR REPLACE FUNCTION normalize_string(input TEXT) RETURNS TEXT AS $$
      BEGIN
        RETURN lower(trim(input));
      END;
      $$ LANGUAGE plpgsql;
  `;

  progressBar.tick();

  // Create the generate_hash function
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
  progressBar.tick();

  // Create indexes
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
        min(ctid) AS min_ctid,
        generate_hash("merchantNameOnSite", COALESCE("idInSite", "title"), "locale", "sourceUrl") AS hash_value,
        "locale",
        "idInSite",
        "sourceUrl",
        "merchantNameOnSite",
        "title",
        "termsAndConditions",
        "description",
        "archivedReason",
        "code",
        COUNT(*) AS duplicate_count,
        MAX("expiryDateAt") AS "expiryDateAt",
        MAX("startDateAt") AS "startDateAt",
        GREATEST(MAX("isShown"::int)::boolean) AS "isShown",
        GREATEST(MAX("isExpired"::int)::boolean) AS "isExpired",
        GREATEST(MAX("isExclusive"::int)::boolean) AS "isExclusive",
        MIN("firstSeenAt") AS "firstSeenAt",
        MAX("lastSeenAt") AS "lastSeenAt",
        MAX("lastCrawledAt") AS "lastCrawledAt",
        MAX("archivedAt") AS "archivedAt",
        GREATEST(MAX("shouldBeFake"::int)::boolean) AS "shouldBeFake"
      FROM
        "Coupon"
      GROUP BY
        "hash_value",
        "locale",
        "idInSite",
        "sourceUrl",
        "merchantNameOnSite",
        "title",
        "termsAndConditions",
        "description",
        "archivedReason",
        "code";
  `;
  progressBar.tick();

  // Delete duplicates and keep the most recent record
  await prisma.$executeRaw`
  DELETE FROM "Coupon"
  USING temp_coupon AS t
  WHERE t.hash_value = generate_hash("Coupon"."merchantNameOnSite", COALESCE("Coupon"."idInSite", "Coupon"."title"), "Coupon"."locale", "Coupon"."sourceUrl")
  AND "Coupon".ctid <> t.min_ctid;
  `;
  progressBar.tick();

  // Update the original table with merged data
  await prisma.$executeRaw`
      UPDATE "Coupon"
      SET
        "id" = t."hash_value",
        "merchantNameOnSite" = t."merchantNameOnSite",
        "title" = t."title",
        "description" = t."description",
        "termsAndConditions" = t."termsAndConditions",
        "expiryDateAt" = t."expiryDateAt",
        "code" = t."code",
        "startDateAt" = t."startDateAt",
        "isShown" = t."isShown",
        "isExpired" = t."isExpired",
        "isExclusive" = t."isExclusive",
        "firstSeenAt" = t."firstSeenAt",
        "lastSeenAt" = t."lastSeenAt",
        "lastCrawledAt" = t."lastCrawledAt",
        "archivedAt" = t."archivedAt",
        "shouldBeFake" = t."shouldBeFake",
        "archivedReason" = t."archivedReason"
      FROM temp_coupon AS t
      WHERE "Coupon".ctid = t.min_ctid;
  `;
  progressBar.tick();

  console.log('Migration completed successfully.');
}

migrateCouponsId()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
