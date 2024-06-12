/*
  Warnings:

  - You are about to drop the column `localeId` on the `Coupon` table. All the data in the column will be lost.
  - Made the column `locale` on table `Coupon` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Coupon" DROP CONSTRAINT "Coupon_localeId_fkey";

-- DropIndex
DROP INDEX "Coupon_localeId_idx";

-- AlterTable
ALTER TABLE "Coupon" DROP COLUMN "localeId",
ALTER COLUMN "locale" SET NOT NULL;

-- AlterTable
ALTER TABLE "TargetPage" ADD COLUMN     "verified_locale" TEXT;

-- CreateIndex
CREATE INDEX "Coupon_locale_idx" ON "Coupon"("locale");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_locale_fkey" FOREIGN KEY ("locale") REFERENCES "TargetLocale"("locale") ON DELETE CASCADE ON UPDATE CASCADE;
