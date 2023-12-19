-- CreateEnum
CREATE TYPE "ArchiveReason" AS ENUM ('expired', 'unexpired', 'manual');

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "archivedReason" "ArchiveReason";
