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

export async function checkCouponIds(ids) {
  try {
    const response = await axios.post(
      'https://codes-api-d9jbl.ondigitalocean.app/coupons/match-ids',
      { ids: ids }
    );

    // response.data contains the array of indices of coupons that exist
    const existingIdsIndices = response.data;

    // Convert indices back to IDs
    const existingIds = existingIdsIndices.map((index) => ids[index]);

    // Filter the original IDs array to get only the non-existing IDs
    const nonExistingIds = ids.filter((id) => !existingIds.includes(id));
    console.log('Non-existing IDs count:', nonExistingIds.length);

    return nonExistingIds;
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
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
export function getDomainName(url: string): string {
  const parsedUrl = new URL(url);

  // Extract hostname from URL or an empty string if the URL is invalid
  let hostname = parsedUrl?.hostname || '';

  // Remove 'www.' if present
  if (hostname.startsWith('www.')) {
    hostname = hostname.substring(4);
  }

  return hostname;
}

// Sleeps for the specified number of milliseconds
export function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function processAndStoreData(validator: DataValidator) {
  try {
    validator.finalCheck();
    console.log(validator.getData());
    await Dataset.pushData(validator.getData());
  } finally {
    // We don't catch so that the error is logged in Sentry, but use finally
    // since we want the Apify actor to end successfully and not waste resources by retrying.
  }
}

export function extractDomainFromUrl(url: string): string {
  // Regular expression to extract the domain name
  const regex = /https?:\/\/[^/]+\/[^/]+\/([^/]+)/;

  // Find matches
  const matches = url.match(regex);

  if (matches && matches[1]) {
    // Remove 'www.' if present
    if (matches[1].startsWith('www.')) {
      return matches[1].substring(4);
    }
    return matches[1];
  }

  return '';
}
