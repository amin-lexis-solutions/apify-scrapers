-- CreateTable
CREATE TABLE "SourceDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "SourceDomain_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SourceDomain" ADD CONSTRAINT "SourceDomain_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Source" DROP COLUMN "domain";

-- CreateIndex
CREATE UNIQUE INDEX "Source_apifyActorId_key" ON "Source"("apifyActorId");