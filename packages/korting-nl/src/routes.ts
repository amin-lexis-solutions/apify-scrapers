import { createCheerioRouter, log } from 'crawlee';
import * as he from 'he';
import { DataValidator } from 'shared/data-validator';
import { generateHash, logError } from 'shared/helpers';
import { Label } from 'shared/actor-utils';
import { postProcess, preProcess } from 'shared/hooks';

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

  if (merchantNameElement.length === 0) {
    logError('Merchant name is missing');
    return;
  }

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
const getItemTitle = (elem, pageType) => {
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
    logError('Request queue is missing');
    return;
  }

  const items = $('article.offer_grid').toArray();

  try {
    await preProcess(
      {
        AnomalyCheckHandler: {
          items,
        },
        IndexPageHandler: {
          indexPageSelectors: request.userData.pageSelectors,
        },
      },
      context
    );
  } catch (error: any) {
    logError(`Pre-Processing Error : ${error.message}`);
    return;
  }

  const pageType = $('.rh-mini-sidebar').length ? 'listing' : 'detail';

  log.info(`Processing URL: ${request.url}`);

  const merchantName = getMerchantName($, pageType);

  if (!merchantName) {
    logError('merchantName not found');
    return;
  }

  if (pageType === 'listing') {
    items.each(async (_, elem) => {
      const element = $(elem);
      const { hasCode, elemCode } = getCouponCode(element);
      const itemTitle = getItemTitle(element, pageType);

      if (!itemTitle) {
        logError('Title not found');
        return;
      }

      const idInSite = generateHash(merchantName, itemTitle, request.url);

      const isExpired = elemCode?.hasClass('expired_coupon');

      const validator = new DataValidator();
      validator.addValue('sourceUrl', request.url);
      validator.addValue('merchantName', merchantName);
      validator.addValue('title', itemTitle);
      validator.addValue('idInSite', idInSite);
      validator.addValue('isExpired', isExpired);
      validator.addValue('isShown', true);

      if (hasCode) {
        const coupon = getCoupon(elemCode);
        validator.addValue('code', coupon);
      }

      try {
        await postProcess(
          {
            SaveDataHandler: {
              validator,
            },
          },
          context
        );
      } catch (error: any) {
        logError(`Post-Processing Error : ${error.message}`);
        return;
      }
    });
    return;
  }

  const elem = $('.single_compare_right');
  const { hasCode, elemCode } = getCouponCode(elem);
  const itemTitle = getItemTitle(elem, pageType);
  const idInSite = generateHash(merchantName, itemTitle, request.url);
  const description = decodeHtml($('article.post-inner p')?.text()?.trim());

  const validator = new DataValidator();
  validator.addValue('sourceUrl', request.url);
  validator.addValue('merchantName', merchantName);
  validator.addValue('title', itemTitle);
  validator.addValue('description', description);
  validator.addValue('idInSite', idInSite);
  validator.addValue('isExpired', elemCode?.hasClass('expired_coupon'));
  validator.addValue('isShown', true);

  if (hasCode) {
    const coupon = getCoupon(elemCode);
    validator.addValue('code', coupon);
  }

  try {
    await postProcess(
      {
        SaveDataHandler: {
          validator,
        },
      },
      context
    );
  } catch (error: any) {
    logError(`Post-Processing Error : ${error.message}`);
    return;
  }
};

router.addHandler(Label.listing, processCoupon);
