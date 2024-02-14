/*
  Warnings:

  - The primary key for the `ProcessedRun` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `sourceLocale` on the `Source` table. All the data in the column will be lost.
  - You are about to drop the column `sourceName` on the `Source` table. All the data in the column will be lost.
  - You are about to drop the column `sourceStartUrl` on the `Source` table. All the data in the column will be lost.
  - Added the required column `apifyActorId` to the `Source` table without a default value. This is not possible if the table is not empty.
  - Added the required column `domain` to the `Source` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `Source` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ProcessedRun" DROP CONSTRAINT "ProcessedRun_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "ProcessedRun_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "ProcessedRun_id_seq";

-- AlterTable
ALTER TABLE "Source" DROP COLUMN "sourceLocale",
DROP COLUMN "sourceName",
DROP COLUMN "sourceStartUrl",
ADD COLUMN     "apifyActorId" TEXT NOT NULL,
ADD COLUMN     "domain" TEXT NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "name" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "TargetLocale" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "searchTemplate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetLocale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetPage" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "searchPosition" INTEGER NOT NULL,
    "searchDomain" TEXT NOT NULL,
    "apifyRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localeId" TEXT NOT NULL,

    CONSTRAINT "TargetPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TargetPage_url_key" ON "TargetPage"("url");

-- CreateIndex
CREATE INDEX "TargetPage_domain_idx" ON "TargetPage"("domain");

-- AddForeignKey
ALTER TABLE "TargetPage" ADD CONSTRAINT "TargetPage_localeId_fkey" FOREIGN KEY ("localeId") REFERENCES "TargetLocale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
