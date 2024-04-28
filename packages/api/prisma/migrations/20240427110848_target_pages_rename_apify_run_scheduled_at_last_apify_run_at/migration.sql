/*
  Warnings:

  - You are about to drop the column `apifyRunScheduledAt` on the `TargetPage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "TargetPage" DROP COLUMN "apifyRunScheduledAt",
ADD COLUMN     "lastApifyRunAt" TIMESTAMP(3);
