-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "oberst_id" BIGINT NOT NULL,
    "locale" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Merchant_disabledAt_idx" ON "Merchant"("disabledAt");

-- CreateIndex
CREATE INDEX "Merchant_oberst_id_idx" ON "Merchant"("oberst_id");

-- CreateIndex
CREATE INDEX "Merchant_locale_idx" ON "Merchant"("locale");

-- CreateIndex
CREATE INDEX "Merchant_name_idx" ON "Merchant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_locale_oberst_id_key" ON "Merchant"("locale", "oberst_id");

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_locale_fkey" FOREIGN KEY ("locale") REFERENCES "TargetLocale"("locale") ON DELETE CASCADE ON UPDATE CASCADE;
