import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import * as chrono from 'chrono-node';
import moment from 'moment';
import { DataValidator } from 'shared/data-validator';
import { Dataset, log } from 'crawlee';

// Normalizes strings by trimming, converting to lowercase, and replacing multiple spaces with a single space
function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
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

export function handleException(exception: string) {
  log.error(exception);
  Sentry.captureException(exception);
}
