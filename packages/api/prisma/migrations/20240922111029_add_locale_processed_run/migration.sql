-- DropForeignKey
ALTER TABLE "ProcessedRun"
DROP CONSTRAINT "ProcessedRun_localeId_fkey";

-- AlterTable
ALTER TABLE "ProcessedRun" ADD COLUMN "locale" TEXT;

-- AddForeignKey
ALTER TABLE "ProcessedRun"
ADD CONSTRAINT "ProcessedRun_locale_fkey" FOREIGN KEY ("locale") REFERENCES "TargetLocale" ("locale") ON DELETE SET NULL ON UPDATE CASCADE;

-- Populate locale based on localeId
UPDATE "ProcessedRun"
SET
    "locale" = (
        SELECT "locale"
        FROM "TargetLocale"
        WHERE
            "id" = "ProcessedRun"."localeId"
    );