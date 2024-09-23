/*
  Warnings:

  - You are about to drop the column `localeId` on the `TargetPage` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[url,locale]` on the table `TargetPage` will be added. If there are existing duplicate values, this will fail.
  - Made the column `locale` on table `TargetPage` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "TargetPage" DROP CONSTRAINT "TargetPage_localeId_fkey";

-- DropIndex
DROP INDEX "TargetPage_localeId_idx";

-- DropIndex
DROP INDEX "TargetPage_url_key";

-- AlterTable
ALTER TABLE "TargetPage" DROP COLUMN "localeId",
ALTER COLUMN "locale" SET NOT NULL;

-- CreateIndex
CREATE INDEX "TargetPage_locale_idx" ON "TargetPage"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "TargetPage_url_locale_key" ON "TargetPage"("url", "locale");

-- AddForeignKey
ALTER TABLE "TargetPage" ADD CONSTRAINT "TargetPage_locale_fkey" FOREIGN KEY ("locale") REFERENCES "TargetLocale"("locale") ON DELETE RESTRICT ON UPDATE CASCADE;
