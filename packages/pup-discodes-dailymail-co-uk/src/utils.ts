import crypto from 'crypto';

import { Dataset } from 'apify';
import * as chrono from 'chrono-node';
import moment from 'moment';

import { DataValidator } from './data-validator';

// Normalizes strings by trimming, converting to lowercase, and replacing multiple spaces with a single space
function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
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

// Extracts the domain name from a URL, removing 'www.' if present
export function getDomainName(url: string): string {
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname;

    // Remove 'www.' if present
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    return hostname;
  } catch (error) {
    console.error('Invalid URL:', error);
    return '';
  }
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
  } catch (error) {
    if (error instanceof Error) {
      console.error('Validation error:', error.message);
      // Handle invalid entries or log them depending on your use case
    } else {
      console.error('An unexpected error occurred:', error);
      // Handle or log the unknown error
    }
  }
}
