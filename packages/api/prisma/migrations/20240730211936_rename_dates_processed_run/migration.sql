ALTER TABLE "ProcessedRun" RENAME COLUMN "finishedAt" TO "startedAt";

ALTER TABLE "ProcessedRun" RENAME COLUMN "processedAt" TO "endedAt";