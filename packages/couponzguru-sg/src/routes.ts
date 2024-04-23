import { DataValidator } from 'shared/data-validator';
import { createCheerioRouter } from 'crawlee';
import {
    processAndStoreData,
    generateCouponId,
    checkCouponIds,
    CouponItemResult,
    CouponHashMap,
  } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import cheerio from 'cheerio';

export const router = createCheerioRouter();

function processCouponItem (
    merchantName:string,
    element: cheerio.Element,
    sourceUrl: string
): CouponItemResult {

    const $coupon = cheerio.load(element);
        
    const code = $coupon('.hide span#code')?.text()?.trim();
    const title = $coupon('h3 a')?.text()?.trim();
    const desc = $coupon('.coupon-description')?.text().replaceAll('\n', ' ')?.trim();
    const idInSite = $coupon('.hide').prev().attr('id')?.split("hide-")?.[1];

    if (!idInSite) {
        throw new Error('Element data-promotion-id attr is missing');
    }
    let hasCode = (code.length === 0) ? true : false;

    const validator = new DataValidator();

    validator.addValue('idInSite', idInSite)
    validator.addValue('title', title)
    validator.addValue('merchantName', merchantName)
    validator.addValue('sourceUrl', sourceUrl)
    validator.addValue('description', desc)
    validator.addValue('isShown', hasCode)
    validator.addValue('isExpired', false)

    if (hasCode) validator.addValue('code', code);
    
    const generatedHash = generateCouponId(merchantName, idInSite, sourceUrl);

    return { generatedHash, hasCode, couponUrl: '', validator };
}
router.addHandler(Label.listing, async ({ request, $, log }) => {
    
    try {
        log.info(`Listing ${request.url}`);

        const merchantName = $('.brand-heading h1').text()?.split(" ")?.[0]
        const validCoupons = $('.coupon-list');
        // Extract valid coupons
        const couponsWithCode: CouponHashMap = {};
        const idsToCheck: string[] = [];
        let result: CouponItemResult;
        // Loop for valid coupon item
        for (const coupon of validCoupons) {
            result = processCouponItem(merchantName, coupon, request.url)
            if (result.hasCode) {
                couponsWithCode[result.generatedHash] = result;
                idsToCheck.push(result.generatedHash);
            } else {
                await processAndStoreData(result.validator);
            }
        }
        // Call the API to check if the coupon exists
        const nonExistingIds = await checkCouponIds(idsToCheck);

        if (nonExistingIds.length == 0) return;

        let currentResult: CouponItemResult;
        for (const id of nonExistingIds) {
          currentResult = couponsWithCode[id];
          // Add coupon
          await processAndStoreData(currentResult.validator)
        }
    } finally {

    }
});
