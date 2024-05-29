import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import {
  CouponHashMap,
  CouponItemResult,
  checkCouponIds,
  generateHash,
} from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';

export const router = Router.create<PuppeteerCrawlingContext>();

async function process(
  coupon,
  couponUrl,
  merchantName,
  domain
): Promise<CouponItemResult> {
  const idInSite = await coupon.evaluate((node) => node.getAttribute(`id`));
  const title = await coupon.$eval(`.offer h2`, (node) => node.textContent);
  const desc = await coupon.$eval(`.offer p`, (node) => node.textContent);

  const codeElement = await coupon.$('strong');

  const code = codeElement
    ? await codeElement.evaluate((node) => node.textContent)
    : null;

  const hasCode = !!code;

  const validator = new DataValidator();

  validator.addValue('sourceUrl', couponUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', title);
  validator.addValue('idInSite', idInSite);
  validator.addValue('domain', domain);
  validator.addValue('code', code);
  validator.addValue('description', desc);
  validator.addValue('isExpired', false);
  validator.addValue('isShown', true);

  const generatedHash = generateHash(merchantName, title, couponUrl);

  return { generatedHash, validator, hasCode, couponUrl };
}
router.addHandler(Label.listing, async (context) => {
  const { request, page, log } = context;

  log.info(`Listing ${request.url}`);

  const couponList = await page.$$('article');

  if (!couponList) {
    log.warning(`Coupon List not found ${request.url}`);
  }

  const merchantElement = await page.$('.sle img');

  const merchantName = await merchantElement?.evaluate(
    (img) => img.getAttribute('alt')?.split('.')?.[0]
  );

  if (!merchantName) {
    log.info('merchantName not found');
  }

  const domain = await merchantElement?.evaluate((img) =>
    img.getAttribute('alt')?.toLowerCase()
  );

  if (!domain) {
    log.info('Domain not found');
  }
  // pre-pressing hooks here to avoid unnecessary requests
  try {
    await preProcess(
      {
        AnomalyCheckHandler: {
          coupons: couponList,
        },
      },
      context
    );
  } catch (error: any) {
    log.warning(`Pre-Processing Error : ${error.message}`);
    return;
  }

  // Initialize variables
  const couponsWithCode: CouponHashMap = {};
  const idsToCheck: string[] = [];
  let processedData: any = {};

  // Loop through each coupon element and process it
  for (const coupon of couponList) {
    processedData = await process(coupon, request.url, merchantName, domain);
    // If coupon has no code, process and store its data
    if (processedData.hasCode) {
      couponsWithCode[processedData.generatedHash] = processedData;
      idsToCheck.push(processedData.generatedHash);
      continue;
    }

    try {
      await postProcess(
        {
          SaveDataHandler: {
            validator: processedData.validator,
          },
        },
        context
      );
    } catch (error: any) {
      log.warning(`Post-Processing Error : ${error.message}`);
      return;
    }
  }
  // Call the API to check if the coupon exists
  const nonExistingIds = await checkCouponIds(idsToCheck);
  // If non-existing coupons are found, process and store their data
  if (nonExistingIds.length == 0) return;

  let currentResult: CouponItemResult;
  // Loop through each nonExistingIds and process it
  for (const id of nonExistingIds) {
    currentResult = couponsWithCode[id];
    await postProcess(
      {
        SaveDataHandler: {
          validator: currentResult.validator,
        },
      },
      context
    );
  }
});
