/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Test` table. All the data in the column will be lost.
  - You are about to drop the column `lastTestRunAt` on the `Test` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Test" DROP COLUMN "createdAt",
DROP COLUMN "lastTestRunAt",
ADD COLUMN     "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
