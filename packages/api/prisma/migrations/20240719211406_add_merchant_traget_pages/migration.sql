-- AlterTable
ALTER TABLE "TargetPage" ADD COLUMN     "merchantId" TEXT;

-- CreateIndex
CREATE INDEX "TargetPage_merchantId_idx" ON "TargetPage"("merchantId");

-- AddForeignKey
ALTER TABLE "TargetPage" ADD CONSTRAINT "TargetPage_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
