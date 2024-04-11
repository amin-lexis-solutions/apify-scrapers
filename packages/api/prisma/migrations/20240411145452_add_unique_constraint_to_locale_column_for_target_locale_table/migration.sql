/*
  Warnings:

  - A unique constraint covering the columns `[locale]` on the table `TargetLocale` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "TargetLocale_locale_key" ON "TargetLocale"("locale");
