/*
Warnings:
- You are about to drop the column `merchantName` on the `Coupon` table. All the data in the column will be lost.
- Added the required column `merchantNameOnSite` to the `Coupon` table without a default value. This is not possible if the table is not empty.
*/
-- Rename the column
ALTER TABLE "Coupon"
RENAME COLUMN "merchantName" TO "merchantNameOnSite";

-- Rename the index
ALTER INDEX "Coupon_merchantName_idx"
RENAME TO "Coupon_merchantNameOnSite_idx";