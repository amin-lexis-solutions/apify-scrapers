-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idInSite" TEXT NOT NULL,
    "domain" TEXT,
    "merchantName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "termsAndConditions" TEXT,
    "expiryDateAt" TIMESTAMP(3),
    "code" TEXT,
    "startDateAt" TIMESTAMP(3),
    "sourceUrl" TEXT NOT NULL,
    "isShown" BOOLEAN,
    "isExpired" BOOLEAN,
    "isExclusive" BOOLEAN,
    "firstScrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceLocale" TEXT NOT NULL,
    "sourceStartUrl" TEXT NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedRun" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRunId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,

    CONSTRAINT "ProcessedRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedRun_actorRunId_key" ON "ProcessedRun"("actorRunId");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
