/*
Warnings:
- Made the column `isShown` on table `Coupon` required. This step will fail if there are existing NULL values in that column.
*/
-- AlterTable
ALTER TABLE "Coupon"
ALTER COLUMN "isShown"
SET NOT NULL,
ALTER COLUMN "isShown"
SET DEFAULT false;

-- CreateIndex
CREATE INDEX "Coupon_isShown_idx" ON "Coupon" ("isShown");