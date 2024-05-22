import { createCheerioRouter } from 'crawlee';
import cheerio from 'cheerio';
import { DataValidator } from 'shared/data-validator';
import {
  checkExistingCouponsAnomaly,
  processAndStoreData,
} from 'shared/helpers';
import { Label } from 'shared/actor-utils';

export const router = createCheerioRouter();

async function processCouponItem(
  merchantName: string,
  element: cheerio.Element,
  sourceUrl: string
) {
  const $coupon = cheerio.load(element);

  function getTitle() {
    let title;
    const titleElement = $coupon('.coupon-meta h3');
    if (titleElement) {
      title = titleElement.text().trim();
    }
    return title;
  }

  function getDescription() {
    let description;
    const descElement = $coupon('.coupon-meta p');
    if (descElement) {
      description = descElement.text();
    }
    return description;
  }

  function getIdInSite() {
    let idInSite;
    const modalElement = $coupon('.modal');
    if (modalElement) {
      idInSite = modalElement.attr('id')?.split('_id_')[1];
    }
    return idInSite;
  }

  function getCode() {
    let code;
    const codeElement = $coupon('.showcode .coupon-code');
    if (codeElement) {
      code = codeElement.text();
    }
    return code;
  }

  function couponExpired() {
    let expired = false;
    const isExpiredElement = $coupon('.coupon-bottom').first().text();
    if (isExpiredElement) {
      expired = !isExpiredElement.includes('Giltig till: Tills vidare');
    }
    return expired;
  }

  const code = getCode();
  const voucherTitle = getTitle();
  const description = getDescription();
  const idInSite = getIdInSite();
  const isExpired = couponExpired();

  const validator = new DataValidator();

  validator.addValue('sourceUrl', sourceUrl);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('idInSite', idInSite);
  validator.addValue('description', description);
  validator.addValue('isExpired', isExpired);
  validator.addValue('isShown', true);

  if (code) {
    validator.addValue('code', code);
  }
  await processAndStoreData(validator);
}
router.addHandler(Label.listing, async (context) => {
  const { request, $, crawler, log } = context;

  if (request.userData.label !== Label.listing) return;

  if (!crawler.requestQueue) {
    log.error('Request queue is missing');
  }

  try {
    log.info(`\nProcessing URL: ${request.url}`);

    const merchantElement = $('.bread .breadcrumb .active');

    if (!merchantElement) {
      log.warning('merchan name not found');
    }

    const merchantName = merchantElement.text()?.split('rabattkoder')[0];

    const validCoupons = $('.coupon-list .coupon-wrapper');

    const hasAnomaly = await checkExistingCouponsAnomaly(
      request.url,
      validCoupons.length
    );

    if (hasAnomaly) {
      log.error(`Coupons anomaly detected - ${request.url}`);
      return;
    }

    for (const element of validCoupons) {
      await processCouponItem(merchantName, element, request.url);
    }
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
});
