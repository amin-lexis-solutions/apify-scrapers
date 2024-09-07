-- CreateIndex
CREATE INDEX "Coupon_merchantName_idx" ON "Coupon"("merchantName");

-- CreateIndex
CREATE INDEX "Coupon_isExpired_idx" ON "Coupon"("isExpired");

-- CreateIndex
CREATE INDEX "Coupon_sourceUrl_idx" ON "Coupon"("sourceUrl");

-- CreateIndex
CREATE INDEX "Coupon_lastSeenAt_idx" ON "Coupon"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Source_name_idx" ON "Source"("name");

-- CreateIndex
CREATE INDEX "Source_apifyActorId_idx" ON "Source"("apifyActorId");

-- CreateIndex
CREATE INDEX "SourceDomain_reliability_idx" ON "SourceDomain"("reliability");

-- CreateIndex
CREATE INDEX "SourceDomain_domain_idx" ON "SourceDomain"("domain");

-- CreateIndex
CREATE INDEX "SourceDomain_apifyActorId_idx" ON "SourceDomain"("apifyActorId");

-- CreateIndex
CREATE INDEX "TargetLocale_locale_idx" ON "TargetLocale"("locale");
