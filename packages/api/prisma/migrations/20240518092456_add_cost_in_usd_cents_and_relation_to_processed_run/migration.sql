-- DropForeignKey
ALTER TABLE "ProcessedRun" DROP CONSTRAINT "ProcessedRun_actorId_fkey";

-- AlterTable
ALTER TABLE "ProcessedRun" ADD COLUMN     "costInUsdMicroCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "localeId" TEXT,
ALTER COLUMN "sourceId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ProcessedRun" ADD CONSTRAINT "ProcessedRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedRun" ADD CONSTRAINT "ProcessedRun_localeId_fkey" FOREIGN KEY ("localeId") REFERENCES "TargetLocale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
