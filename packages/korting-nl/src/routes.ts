import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { processAndStoreData, generateHash } from 'shared/helpers';
import { Label } from 'shared/actor-utils';

export const router = createCheerioRouter();

// Function to decode HTML entities
const decodeHtml = (html) => he.decode(html);

// Function to get merchant name based on page type
const getMerchantName = ($, pageType) => {
  const selector =
    pageType === 'listing'
      ? '.woo-tax-logo img'
      : '.rh-cat-list-title a:last-child';
  const merchantNameElement = $(selector);

  if (merchantNameElement.length === 0)
    throw new Error('Merchant name is missing');

  return decodeHtml(
    (pageType === 'listing'
      ? merchantNameElement.attr('alt')
      : merchantNameElement.text()
    ).trim()
  );
};

// Function to get coupon code
const getCouponCode = (elem) => {
  const couponElement = elem.find('.rehub_offer_coupon');
  return {
    hasCode: couponElement.length > 0,
    elemCode: couponElement,
  };
};

// Function to get voucher title
const getVoucherTitle = (elem, pageType) => {
  const titleElement =
    pageType === 'listing' ? elem.find('h3') : elem.find('h1');
  if (titleElement.length === 0) {
    throw new Error('Voucher title is missing');
  }
  return decodeHtml(titleElement.text().trim());
};

// Function to extract coupon details
const getCoupon = (elemCode) => {
  return (
    elemCode?.attr('data-clipboard-text')?.trim() ||
    elemCode?.find('.coupon_text')?.text().trim() ||
    null
  );
};

// Main processing function
const processCoupon = async (context) => {
  const { request, $, crawler } = context;
  if (!crawler.requestQueue) {
    log.error('Request queue is missing');
  }

  const label = request.userData.label;
  if (!label) return;

  const pageType = $('.rh-mini-sidebar').length ? 'listing' : 'detail';
  console.log(`\nProcessing URL: ${request.url}`);

  const merchantName = getMerchantName($, pageType);

  if (pageType === 'listing') {
    $('article.offer_grid').each((_, elem) => {
      const element = $(elem);
      const { hasCode, elemCode } = getCouponCode(element);
      const voucherTitle = getVoucherTitle(element, pageType);
      const idInSite = generateHash(merchantName, voucherTitle, request.url);

      const validator = new DataValidator();
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', voucherTitle);
      validator.addValue('idInSite', idInSite);
      validator.addValue(
        'isExpired',
        elemCode?.hasClass('expired_coupon') || false
      );
      validator.addValue('isShown', true);

      if (hasCode) {
        const coupon = getCoupon(elemCode);
        validator.addValue('code', coupon);
      }

      processAndStoreData(validator);
    });
    return;
  }

  const elem = $('.single_compare_right');
  const { hasCode, elemCode } = getCouponCode(elem);
  const voucherTitle = getVoucherTitle(elem, pageType);
  const idInSite = generateHash(merchantName, voucherTitle, request.url);
  const description =
    decodeHtml($('article.post-inner p').text().trim()) || null; // Extracting description

  const validator = new DataValidator();
  validator.addValue('sourceUrl', request.url);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', voucherTitle);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue(
    'isExpired',
    elemCode?.hasClass('expired_coupon') || false
  );
  validator.addValue('isShown', true);

  if (hasCode) {
    const coupon = getCoupon(elemCode);
    validator.addValue('code', coupon);
  }

  processAndStoreData(validator);
};

router.addHandler(Label.listing, processCoupon);
