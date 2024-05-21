-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "apifyTestRunId" TEXT NOT NULL,
    "apifyActorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);
