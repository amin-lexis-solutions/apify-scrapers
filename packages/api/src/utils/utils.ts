import crypto from 'crypto';

import { getDomainName } from 'shared/helpers';

export function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function generateHash(
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

export function validDateOrNull(dateString: string) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function getWebhookUrl(path: string): string {
  const hostname = process.env.BASE_URL?.endsWith('/')
    ? process.env.BASE_URL.replace(/\/$/, '')
    : process.env.BASE_URL;

  return hostname + path;
}

/**
 * Calculates the standard deviation of an array of numbers.
 * @param {number[]} counts - The array of numbers for which to calculate the standard deviation.
 * @returns {number} The standard deviation of the numbers in the array. Returns 0 for an empty array.
 */
export function calculateStandardDeviation(counts: number[]): number {
  const standard_Deviation: number =
    Number(process.env.STANDARD_DEVIATION) || 5;

  // Ensure the input is an array of numbers
  if (
    !Array.isArray(counts) ||
    !counts.every((num) => typeof num === 'number')
  ) {
    throw new TypeError('Input must be an array of numbers.');
  }

  // If all counts are the same number, standard deviation is 5 (arbitrary value)
  if (new Set(counts).size === 1) {
    return standard_Deviation;
  }
  const n = counts.length;

  // If no counts are provided, return 0
  if (n === 0) {
    return standard_Deviation;
  }

  let sum = 0;
  let squareSum = 0;

  // Calculate sum and square sum in a single iteration
  for (const count of counts) {
    sum += count;
    squareSum += count * count;
  }

  // Calculate mean and variance using the formulas
  const mean = sum / n;
  const variance = (squareSum - sum * mean) / n;

  // Calculate standard deviation as square root of variance
  return Math.sqrt(variance);
}
