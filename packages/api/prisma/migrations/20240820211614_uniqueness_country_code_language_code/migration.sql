/*
  Warnings:

  - A unique constraint covering the columns `[countryCode,languageCode]` on the table `TargetLocale` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "TargetLocale_countryCode_languageCode_key" ON "TargetLocale"("countryCode", "languageCode");
