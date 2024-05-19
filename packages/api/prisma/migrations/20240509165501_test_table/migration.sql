-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "apifyRunId" TEXT,
    "apifyActorId" TEXT NOT NULL,
    "lastApifyRunAt" TIMESTAMP(3),
    "startUrls" TEXT[],
    "status" TEXT,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);
