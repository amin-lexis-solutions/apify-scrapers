/*
  Warnings:

  - Made the column `merchantId` on table `TargetPage` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "TargetPage" DROP CONSTRAINT "TargetPage_merchantId_fkey";

-- AlterTable
ALTER TABLE "TargetPage" ALTER COLUMN "merchantId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "TargetPage" ADD CONSTRAINT "TargetPage_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
