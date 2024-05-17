import crypto from 'crypto';
import * as chrono from 'chrono-node';
import moment from 'moment';
import axios from 'axios';
import { DataValidator } from './data-validator';
import { Dataset } from 'apify';

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
    const response = await axios.get(
      'https://codes-api-d9jbl.ondigitalocean.app/sentry/dsn'
    );
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
      'https://codes-api-d9jbl.ondigitalocean.app/items/match-ids',
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
  const normalizedUrl = normalizeString(getDomainName(sourceUrl));

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
  let domain = parsedUrl.hostname;

  // Remove www subdomain if present
  if (domain.startsWith('www.')) {
    domain = domain.slice(4);
  }
  // Remove path and subdomains
  const parts = domain.split('.');
  if (parts.length > 2) {
    domain = parts.slice(-2).join('.');
  }
  // Remove trailing slash if present
  if (parsedUrl.pathname.endsWith('/')) {
    const trimmedPath = parsedUrl.pathname.slice(0, -1);
    const lastSlashIndex = trimmedPath.lastIndexOf('/');
    domain = trimmedPath.slice(lastSlashIndex + 1);
  }
  // Remove hyphens if present
  if (domain.includes('-')) {
    domain = domain.split('-')[0];
  }
  return domain;
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

    const dataset = await Dataset.open();

    // Flag to check if data is already present
    let isDataPresent = false;

    // Loop through dataset to check for duplicate items
    await dataset.forEach((item) => {
      // Check if either idInSite or title of item matches processedData
      isDataPresent =
        item?.idInSite?.includes(processedData?.idInSite) ||
        item?.title?.includes(processedData?.title);
    });
    // If data is already present, exit function
    if (isDataPresent) return;
    // Log processed data
    console.log(processedData);
    // Push processed data to dataset
    await Dataset.pushData(processedData);
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

// Just a wrapper around getDomainName in case already existing code needs to be reused
export function extractDomainFromUrl(url: string): string {
  return getDomainName(url);
}
