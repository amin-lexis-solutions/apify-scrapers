/*
  Warnings:

  - A unique constraint covering the columns `[domain]` on the table `SourceDomain` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "sourceDomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SourceDomain_domain_key" ON "SourceDomain"("domain");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_sourceDomain_fkey" FOREIGN KEY ("sourceDomain") REFERENCES "SourceDomain"("domain") ON DELETE SET NULL ON UPDATE CASCADE;
