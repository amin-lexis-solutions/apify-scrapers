-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
