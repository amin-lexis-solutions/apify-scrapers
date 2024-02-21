/*
  Warnings:

  - A unique constraint covering the columns `[url,localeId]` on the table `TargetPage` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "TargetPage_url_key";

-- CreateIndex
CREATE UNIQUE INDEX "TargetPage_url_localeId_key" ON "TargetPage"("url", "localeId");
