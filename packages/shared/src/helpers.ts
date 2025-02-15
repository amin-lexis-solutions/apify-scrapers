import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import * as chrono from 'chrono-node';
import moment from 'moment';
import axios from 'axios';
import { DataValidator } from './data-validator';
import { Dataset, log } from 'apify';

export type ItemResult = {
  hasCode: boolean;
  itemUrl?: string;
  validator: DataValidator;
};

type IndexPageSelectors = {
  indexSelector: string[];
  nonIndexSelector: string[];
};

export type ItemHashMap = { [key: string]: ItemResult };

// Normalizes strings by trimming, converting to lowercase, and replacing multiple spaces with a single space.
function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function fetchSentryUrl() {
  try {
    const response = await axios.get(`${process.env.BASE_URL}sentry/dsn`);
    console.log('Sentry URL:', response.data.url);
    return response.data.url as string;
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

// Generates a hash from merchant name, voucher title, and source URL
export function generateHash(
  merchantName: string,
  itemIdentifier: string,
  sourceUrl: string
): string {
  const normalizedMerchant = normalizeString(merchantName);
  const normalizedTitle = normalizeString(itemIdentifier);
  const normalizedUrl = normalizeString(sourceUrl);

  const combinedString = `${normalizedMerchant}|${normalizedTitle}|${normalizedUrl}`;

  const hash = crypto.createHash('sha256');
  hash.update(combinedString);
  return hash.digest('hex');
}

// Formats a date string into ISO 8601 format, trying to parse natural language dates first, then falling back to specified formats
export function formatDateTime(text: string): string {
  // Try parsing with chrono-node for natural language dates
  let parsedDate = chrono.parseDate(text);

  // If chrono-node fails to parse, try moment.js with specified formats
  if (!parsedDate) {
    const formats = ['MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY']; // Add more formats as needed
    const momentDate = moment(text, formats, true);
    if (momentDate.isValid()) {
      parsedDate = momentDate.toDate();
    }
  }

  // If no valid date is parsed, return an empty string
  if (!parsedDate) {
    return '';
  }

  // Format to ISO 8601 without considering time zone
  return parsedDate.toISOString().split('Z')[0];
}

// Extracts the domain from a URL and removes 'www.' if present
// In this context domain refers to where coupons is applied.
export function getMerchantDomainFromUrl(url: string): string {
  const parsedUrl = new URL(url);
  let domain: string | undefined = parsedUrl.pathname;

  // Remove 'http://' or 'https://' if present
  domain = domain?.replace(/^(http:\/\/|https:\/\/)|\.html$/g, '');
  // Removes the last character (/)
  if (domain.endsWith('/')) {
    domain = domain?.slice(0, -1);
  }
  // Extract domain from pathname if there's a dot (.)
  if (!domain.includes('.') && parsedUrl.hostname.includes('.')) {
    domain = parsedUrl?.hostname?.split('/')?.[0];
  } else {
    domain = domain.split('/')?.pop();
  }
  // Remove 'www' subdomain if present
  if (domain?.startsWith('www.')) {
    domain = domain.slice(4);
  }
  // Ensure domain contains a dot (.)
  return domain?.includes('.') ? domain : '';
}

// Sleeps for the specified number of milliseconds
export function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function processAndStoreData(
  validator: DataValidator,
  context: any
) {
  try {
    validator.finalCheck();
    // Get processed data from validator
    const processedData = validator.getData();

    // Add metadata to the processed data
    processedData.metadata = context?.request?.userData || {};

    // save the data to the dataset
    Dataset.pushData(processedData);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

export async function checkExistingItemsAnomaly(
  sourceUrl: string,
  count: number
) {
  log.info(`checkExistingItemsAnomaly - ${sourceUrl}`);

  try {
    const response = await axios.post(
      `${process.env.BASE_URL}items/anomaly-detector`,
      {
        sourceUrl,
        couponsCount: count,
      }
    );

    const hasAnomaly = response?.data?.anomalyType;

    if (hasAnomaly) {
      log.error(`Item anomaly detected - ${sourceUrl}`);

      Sentry.captureException(`Item anomaly detected`, {
        extra: {
          url: sourceUrl,
          count,
        },
      });
    }
    return hasAnomaly;
  } catch (e) {
    log.error(`Error fetching Item anomaly`, { e });
  }
}

/**
 * CheckIndexPageSelectors function
 * Verifies index and non index page.
 * @param {IndexPageSelectors} pageSelectors - Selectors.
 * @param {any} context - The context in which the pre-processing is happening.
 */
export async function checkIndexPageSelectors(
  pageSelectors: IndexPageSelectors,
  context: any
): Promise<boolean> {
  const { page, $ } = context;
  const { indexSelector, nonIndexSelector } = pageSelectors;

  // Check if the page is a 404 , if so, mark it as non-index page
  const statusCode =
    context.response.statusCode || (await context.response?.status());
  if (statusCode === 404 || statusCode === 410) {
    await Dataset.pushData({
      __isNotIndexPage: true,
      __url: context.request.url,
    });
    throw new Error(
      `${context.request.url} - ${
        statusCode === 404 ? 'Page not found' : 'Page removed'
      }`
    );
  }

  log.info(`checkIndexPageSelectors ${context.request.url}`);

  // Function to check selectors in Puppeteer
  const puppeteerCheck = async (selectors: string[]) => {
    for (const selector of selectors) {
      const element = await page.$(selector);
      if (element) {
        return true;
      }
    }
    return false;
  };

  // Function to check selectors in Cheerio
  const cheerioCheck = (selectors: string[]) => {
    return selectors.some((selector) => $(selector).length > 0);
  };

  let isIndexPage, isNonIndexPage;

  if (page) {
    // Puppeteer context
    isIndexPage = await puppeteerCheck(indexSelector);
    isNonIndexPage = nonIndexSelector
      ? await puppeteerCheck(nonIndexSelector)
      : false;
  } else if ($) {
    // Cheerio context
    isIndexPage = cheerioCheck(indexSelector);
    isNonIndexPage = nonIndexSelector ? cheerioCheck(nonIndexSelector) : false;
  } else {
    throw new Error(
      'Error checkIndexPageSelectors - Puppeteer Page Browser nor Cheerio Object not found in context'
    );
  }

  if (isNonIndexPage) {
    await Dataset.pushData({
      __isNotIndexPage: true,
      __url: context.request.url,
    });
    throw new Error(`${context.request.url} - Not an index page`);
  }

  return isIndexPage && !isNonIndexPage;
}
