/*
  Warnings:

  - A unique constraint covering the columns `[url]` on the table `TargetPage` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "TargetPage_url_localeId_key";

-- CreateIndex
CREATE UNIQUE INDEX "TargetPage_url_key" ON "TargetPage"("url");

-- CreateIndex
CREATE INDEX "TargetPage_localeId_idx" ON "TargetPage"("localeId");

-- DropIndex
DROP INDEX "TargetPage_domain_idx";
