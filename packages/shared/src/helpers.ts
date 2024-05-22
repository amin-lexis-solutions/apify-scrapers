import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import * as chrono from 'chrono-node';
import moment from 'moment';
import axios from 'axios';
import { DataValidator } from './data-validator';
import { Dataset, log } from 'apify';

export type CouponItemResult = {
  generatedHash: string;
  hasCode: boolean;
  couponUrl: string;
  validator: DataValidator;
};

export type CouponHashMap = { [key: string]: CouponItemResult };

// Normalizes strings by trimming, converting to lowercase, and replacing multiple spaces with a single space
function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function fetchSentryUrl() {
  try {
    const response = await axios.get(`${process.env.BASE_URL}/sentry/dsn`);
    console.log('Sentry URL:', response.data.url);
    return response.data.url as string;
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

export async function checkCouponIds(ids: any[]): Promise<any[]> {
  try {
    // Send a POST request to the API to check if the coupon IDs exist
    const response = await axios.post(
      `${process.env.BASE_URL}/items/match-ids`,
      { ids: ids }
    );

    // response.data contains the array of indices of coupons that exist
    const existingIdsIndices = response.data;

    // Convert indices back to IDs
    const existingIds = existingIdsIndices.map((index: any) => ids[index]);

    // Filter the original IDs array to get only the non-existing IDs
    const nonExistingIds = ids.filter((id: any) => !existingIds.includes(id));
    console.log('Non-existing IDs count:', nonExistingIds.length);

    return nonExistingIds as any[];
  } catch (error) {
    // console.log('Failed to check coupon IDs:', error);
    return [] as any[];
  }
}

export function generateCouponId(
  merchantName: string,
  idInSite: string,
  sourceUrl: string
): string {
  const normalizedMerchant = normalizeString(merchantName);
  const normalizedVoucher = normalizeString(idInSite);

  const domain = getDomainName(sourceUrl);
  const normalizedUrl = domain ? normalizeString(domain) : '';

  const combinedString = `${normalizedMerchant}|${normalizedVoucher}|${normalizedUrl}`;

  const hash = crypto.createHash('sha256');
  hash.update(combinedString);
  return hash.digest('hex');
}

// Generates a hash from merchant name, voucher title, and source URL
export function generateHash(
  merchantName: string,
  voucherTitle: string,
  sourceUrl: string
): string {
  const normalizedMerchant = normalizeString(merchantName);
  const normalizedVoucher = normalizeString(voucherTitle);
  const normalizedUrl = normalizeString(sourceUrl);

  const combinedString = `${normalizedMerchant}|${normalizedVoucher}|${normalizedUrl}`;

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

// Extracts the domain name from a URL and removes 'www.' if present
// In this context domain refers to where coupons is applied.
export function getDomainName(url: string): string {
  const parsedUrl = new URL(url);
  let domain: string | undefined = parsedUrl.pathname;

  // Remove 'http://' or 'https://' if present
  domain = domain?.replace(/^(http:\/\/|https:\/\/)/, '');
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

export async function processAndStoreData(validator: DataValidator) {
  try {
    validator.finalCheck();

    // Get processed data from validator
    const processedData = validator.getData();
    // save the data to the dataset
    Dataset.pushData(processedData);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

// Just a wrapper around getDomainName in case already existing code needs to be reused
// Domain can be null if does not exist.
export function extractDomainFromUrl(url: string): string | null {
  return getDomainName(url);
}

export async function checkExistingCouponsAnomaly(
  sourceUrl: string,
  couponsCount: number
) {
  log.info(`checkExistingCouponsAnomaly - ${sourceUrl}`);

  try {
    const response = await axios.post(
      `${process.env.BASE_URL}/items/anomaly-detector`,
      {
        sourceUrl,
        couponsCount,
      }
    );

    const hasAnomaly = response?.data?.anomalyType;

    if (hasAnomaly) {
      log.error(`Coupons anomaly detected - ${sourceUrl}`);

      Sentry.captureException(`Coupons anomaly detected`, {
        extra: {
          url: sourceUrl,
          couponsCount,
        },
      });
    }
    return hasAnomaly;
  } catch (e) {
    log.error(`Error fetching coupons anomaly`, { e });
  }
}
