/*
  Warnings:

  - You are about to drop the column `sourceId` on the `Coupon` table. All the data in the column will be lost.
  - You are about to drop the column `sourceId` on the `ProcessedRun` table. All the data in the column will be lost.
  - You are about to drop the column `sourceId` on the `SourceDomain` table. All the data in the column will be lost.
  - Made the column `apifyActorId` on table `Coupon` required. This step will fail if there are existing NULL values in that column.
  - Made the column `apifyActorId` on table `SourceDomain` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Coupon" DROP CONSTRAINT "Coupon_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "ProcessedRun" DROP CONSTRAINT "ProcessedRun_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "SourceDomain" DROP CONSTRAINT "SourceDomain_sourceId_fkey";

-- DropIndex
DROP INDEX "Coupon_sourceId_idx";

-- AlterTable
ALTER TABLE "Coupon" DROP COLUMN "sourceId",
ALTER COLUMN "apifyActorId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ProcessedRun" DROP COLUMN "sourceId";

-- AlterTable
ALTER TABLE "SourceDomain" DROP COLUMN "sourceId",
ALTER COLUMN "apifyActorId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Coupon_apifyActorId_idx" ON "Coupon"("apifyActorId");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_apifyActorId_fkey" FOREIGN KEY ("apifyActorId") REFERENCES "Source"("apifyActorId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDomain" ADD CONSTRAINT "SourceDomain_apifyActorId_fkey" FOREIGN KEY ("apifyActorId") REFERENCES "Source"("apifyActorId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedRun" ADD CONSTRAINT "ProcessedRun_apifyActorId_fkey" FOREIGN KEY ("apifyActorId") REFERENCES "Source"("apifyActorId") ON DELETE SET NULL ON UPDATE CASCADE;
