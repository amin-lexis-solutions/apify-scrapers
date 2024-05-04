-- CreateTable
CREATE TABLE "CouponStats" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "averageCouponCount" INTEGER NOT NULL,
    "standardDeviation" DOUBLE PRECISION NOT NULL,
    "surgeThreshold" INTEGER NOT NULL,
    "plungeThreshold" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponAnomalyLog" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "couponCount" INTEGER NOT NULL,
    "anomalyType" TEXT NOT NULL,

    CONSTRAINT "CouponAnomalyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetPage_url_idx" ON "TargetPage"("url");

-- AddForeignKey
ALTER TABLE "CouponStats" ADD CONSTRAINT "CouponStats_sourceUrl_fkey" FOREIGN KEY ("sourceUrl") REFERENCES "TargetPage"("url") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponAnomalyLog" ADD CONSTRAINT "CouponAnomalyLog_sourceUrl_fkey" FOREIGN KEY ("sourceUrl") REFERENCES "TargetPage"("url") ON DELETE RESTRICT ON UPDATE CASCADE;
