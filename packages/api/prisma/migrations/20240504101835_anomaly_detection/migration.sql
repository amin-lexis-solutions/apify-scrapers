-- CreateTable
CREATE TABLE "CouponStats" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "couponsCount" INTEGER NOT NULL,
    "surgeThreshold" INTEGER NOT NULL,
    "plungeThreshold" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponStats_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "TargetPage_url_idx" ON "TargetPage"("url");

-- AddForeignKey
ALTER TABLE "CouponStats" ADD CONSTRAINT "CouponStats_sourceUrl_fkey" FOREIGN KEY ("sourceUrl") REFERENCES "TargetPage"("url") ON DELETE RESTRICT ON UPDATE CASCADE;

