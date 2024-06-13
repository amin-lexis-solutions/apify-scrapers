-- CreateEnum
CREATE TYPE "Reliability" AS ENUM ('reliable', 'unreliable');

-- AlterTable
ALTER TABLE "SourceDomain" ADD COLUMN     "reliability" "Reliability" NOT NULL DEFAULT 'reliable';
