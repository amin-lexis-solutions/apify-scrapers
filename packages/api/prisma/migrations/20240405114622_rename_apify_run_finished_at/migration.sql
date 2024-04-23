/*
  Warnings:

  - You are about to rename the column `apifyRunFinishedAt` on the `TargetPage` table.

*/
-- AlterTable
ALTER TABLE "TargetPage" RENAME COLUMN "apifyRunFinishedAt" TO "apifyRunScheduledAt";
