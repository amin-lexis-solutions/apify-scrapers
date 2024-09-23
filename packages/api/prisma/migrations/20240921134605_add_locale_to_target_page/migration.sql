-- AlterTable
ALTER TABLE "TargetPage" ADD COLUMN "locale" TEXT;

-- Populate locale based on localeId
UPDATE "TargetPage"
SET
    "locale" = (
        SELECT "locale"
        FROM "TargetLocale"
        WHERE
            "id" = "TargetPage"."localeId"
    );