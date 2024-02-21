/*
  Warnings:

  - Added the required column `localeId` to the `Coupon` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "localeId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Coupon_localeId_idx" ON "Coupon"("localeId");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_localeId_fkey" FOREIGN KEY ("localeId") REFERENCES "TargetLocale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
