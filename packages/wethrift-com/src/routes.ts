import { createPuppeteerRouter, sleep } from 'crawlee';
import { Label } from 'shared/actor-utils';
import { DataValidator } from 'shared/data-validator';
import { getMerchantDomainFromUrl } from 'shared/helpers';
import { preProcess, postProcess } from 'shared/hooks';

// Export the router function that determines which handler to use based on the request label
export const router = createPuppeteerRouter();

function processItem(merchantName, merchantDomain, item, sourceUrl) {
  // Create a new DataValidator instance
  const validator = new DataValidator();

  // Add required values to the validator
  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', item.title);
  validator.addValue('idInSite', item.idInSite);

  // Add optional values to the validator
  validator.addValue('domain', merchantDomain);
  validator.addValue('code', item.code);
  validator.addValue('isShown', true);

  const hasCode = item.code ? true : false;

  return { hasCode, validator };
}

router.addHandler(Label.listing, async (context) => {
  const { request, page, log } = context;
  if (request.userData.label !== Label.listing) return;

  try {
    // wait for the page to load completely
    await page.waitForSelector('main article section');

    // load all the coupons by clicking the load more button
    const loadMoreButton = await page.$$('section#more button');

    for (const button of loadMoreButton) {
      await button?.focus();

      await button?.click();
      // Add a delay if needed to avoid overwhelming the server
      await sleep(50);
    }

    // find all the coupons in #top-coupons section
    const topItems =
      (
        await page.$$eval('#top-coupons li', (coupons) => {
          return coupons?.map((coupon) => {
            const title = coupon?.querySelector('h2 span')?.textContent || '';
            const code =
              coupon?.querySelector('button')?.getAttribute('title') || '';
            const idInSite = coupon?.getAttribute('id') || '';
            if (!title) return null;
            return {
              title,
              idInSite,
              code,
            };
          });
        })
      ).filter((coupon) => coupon !== null) || [];

    // find all the coupons in the table
    const otherItems =
      (
        await page.$$eval('section table tbody tr', (coupons) => {
          return coupons?.map((coupon) => {
            const title = coupon?.querySelector('h2')?.textContent || '';
            const code =
              coupon?.querySelector('button')?.getAttribute('title') || '';
            const idInSite = coupon.getAttribute('id') || '';
            if (!title) return null;
            return { title, idInSite, code };
          });
        })
      ).filter((coupon) => coupon !== null) || [];

    const items = [...topItems, ...otherItems];

    try {
      // Preprocess the data
      await preProcess(
        {
          AnomalyCheckHandler: {
            url: request.url,
            items,
          },
          IndexPageHandler: {
            indexPageSelectors: request.userData.pageSelectors,
          },
        },
        context
      );
    } catch (error) {
      log.error(`Preprocess Error: ${error}`);
      return;
    }

    const {
      merchantName,
      merchantSite,
    }: {
      merchantName: string | '';
      merchantSite: string | '';
    } = (await page.$eval('section p a', (a: any) => {
      return {
        merchantName: a.textContent || '',
        merchantSite: a.href || '',
      };
    })) || { merchantName: null, merchantSite: null };

    const merchantDomain = getMerchantDomainFromUrl(merchantSite);

    log.info(`Processing ${merchantName} coupons`);

    // Initialize variables
    let processedData: any = {};

    // Loop through each coupon element and process it
    for (const item of items) {
      processedData = await processItem(
        merchantName,
        merchantDomain,
        item,
        request.url
      );

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
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
