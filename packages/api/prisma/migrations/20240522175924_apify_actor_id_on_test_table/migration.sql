/*
  Warnings:

  - A unique constraint covering the columns `[apifyActorId]` on the table `Test` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Test_apifyActorId_key" ON "Test"("apifyActorId");
