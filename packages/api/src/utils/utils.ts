import crypto from 'crypto';

import { getMerchantDomainFromUrl } from 'shared/helpers';

export function normalizeString(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function generateHash(
  merchantName: string,
  idInSite: string,
  sourceUrl: string
): string {
  const normalizedMerchant = normalizeString(merchantName || '');
  const normalizedVoucher = normalizeString(idInSite || '');
  const domain = getMerchantDomainFromUrl(sourceUrl);
  const normalizedUrl = domain ? normalizeString(domain) : '';

  const combinedString = `${normalizedMerchant}|${normalizedVoucher}|${normalizedUrl}`;

  const hash = crypto.createHash('sha256');
  hash.update(combinedString);
  return hash.digest('hex');
}

export function validDateOrNull(dateString: string) {
  const date = new Date(dateString);
  return !dateString || isNaN(date.getTime()) ? null : date.toISOString();
}

export function getWebhookUrl(path: string): string {
  const hostname = process.env.BASE_URL?.endsWith('/')
    ? process.env.BASE_URL.replace(/\/$/, '')
    : process.env.BASE_URL;

  return hostname + path;
}

// Function to determine tolerance multiplier based on couponCount
export function getToleranceMultiplier(couponCount: number): number {
  if (couponCount < 10) {
    return 3; // 300% tolerance
  } else if (couponCount < 20) {
    return 1; // 100% tolerance
  } else if (couponCount < 50) {
    return 0.5; // 50% tolerance
  } else if (couponCount < 100) {
    return 0.3; // 30% tolerance
  } else if (couponCount < 500) {
    return 0.2; // 20% tolerance
  } else {
    return 0.1; // 10% tolerance
  }
}

// Function to remove duplicate coupons
export function removeDuplicateCoupons(data: any) {
  const seen = new Set();
  const dataArray = Object.values(data);
  return dataArray.reduce((acc: any[], item: any) => {
    const keyString =
      item?.title +
      item?.idInSite +
      item?.sourceUrl +
      item?.merchantName +
      item?.domain;
    // Create a unique key for each item
    const key = crypto.createHash('sha256').update(keyString).digest('hex');

    if (!seen.has(key)) {
      seen.add(key);
      acc.push(item);
    }
    return acc;
  }, []);
}

// Function to extract merchant name from domain name
export function getMerchantName(url: string): string {
  const regex = /^(?<start>([^/]+\/\/)?(www\.)?)(?<domain>.+?)(?<end>(\.[^.]{1,3})+)$/gm;
  const match = regex.exec(url);
  const name = match?.groups?.domain || '';
  return name;
}

export function getGoogleActorPriceInUsdMicroCents(
  totalResults: number
): number {
  const PRICE_PER_1000_RESULTS_IN_USD = 3.5;

  return PRICE_PER_1000_RESULTS_IN_USD * (totalResults / 1000) * 1000000;
}
