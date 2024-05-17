-- DropForeignKey
ALTER TABLE "ProcessedRun" DROP CONSTRAINT "ProcessedRun_actorId_fkey";

-- AlterTable
ALTER TABLE "ProcessedRun" ADD COLUMN     "costInUsdCents" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "localeId" TEXT,
ALTER COLUMN "actorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ProcessedRun" ADD CONSTRAINT "ProcessedRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedRun" ADD CONSTRAINT "ProcessedRun_localeId_fkey" FOREIGN KEY ("localeId") REFERENCES "TargetLocale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
