import { PuppeteerCrawlingContext, Router } from 'crawlee';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

// Export the router function that determines which handler to use based on the request label
const router = Router.create<PuppeteerCrawlingContext>();

router.addHandler(Label.listing, async ({ page, request, enqueueLinks }) => {
  if (request.userData.label !== Label.listing) return;

  async function getMerchantName(page) {
    return await page.evaluate(() => {
      const name = document.querySelector('.m-pageHeader__title')?.textContent;
      return name;
    });
  }
  async function extractIdInSite(element) {
    return await element.evaluate((block) =>
      block.getAttribute('data-offer-id')
    );
  }
  async function makeRequest(couponUrl, validatorData) {
    await enqueueLinks({
      urls: [couponUrl],
      userData: {
        label: Label.getCode,
        validatorData,
      },
      forefront: true,
    });
  }

  try {
    await page.waitForSelector('.-grid');

    const merchantName = await getMerchantName(page);

    if (!merchantName) {
      throw new Error('merchan name not found');
    }

    const validCoupons = await page.$$('.m-offer');

    if (!validCoupons) {
      throw new Error('Valid coupons not found');
    }
    // Extract validCoupons
    for (const element of validCoupons) {
      const hasCode = await element.$(
        '.m-offer__action .a-btnSlide__truncateCode'
      );
      let idInSite;

      const couponTitle = await element.evaluate(
        (node) => node.querySelector('.m-offer__title')?.textContent
      );

      const validator = new DataValidator();

      if (hasCode) {
        idInSite = await element.evaluate((block) =>
          block.getAttribute('data-offer-id')
        );
        validator.addValue('idInSite', idInSite);
        validator.addValue('isExpired', !hasCode);
      }

      validator.addValue('merchantName', merchantName);
      validator.addValue('title', couponTitle);
      validator.addValue('sourceUrl', request.url);
      validator.addValue('isShown', true);

      let couponUrl;
      const validatorData = validator.getData();

      if (idInSite) {
        idInSite = await extractIdInSite(element);
        couponUrl = `https://www.poulpeo.com/o.htm?c=${idInSite}`;
        await makeRequest(couponUrl, validatorData);
      }
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
router.addHandler(Label.getCode, async ({ page, request }) => {
  if (request.userData.label !== Label.getCode) return;

  await page.waitForSelector('#o-modal');

  try {
    const validatorData = request.userData.validatorData;
    const validator = new DataValidator();
    validator.loadData(validatorData);

    const code = await page.evaluate(() =>
      document.querySelector('.coupon-panel #ic')?.getAttribute('value')
    );

    if (code) {
      validator.addValue('code', code);
    }

    await processAndStoreData(validator);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});

export { router };
