/*
  Warnings:

  - You are about to drop the column `firstScrapedAt` on the `Coupon` table. All the data in the column will be lost.
  - You are about to drop the column `lastScrapedAt` on the `Coupon` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Coupon" RENAME COLUMN "firstScrapedAt" TO "firstSeenAt";
ALTER TABLE "Coupon" RENAME COLUMN "lastScrapedAt" TO "lastSeenAt";

-- CreateIndex
CREATE INDEX "Coupon_sourceId_idx" ON "Coupon"("sourceId");

-- CreateIndex
CREATE INDEX "Coupon_archivedAt_idx" ON "Coupon"("archivedAt");

-- CreateIndex
CREATE INDEX "Coupon_domain_idx" ON "Coupon"("domain");
