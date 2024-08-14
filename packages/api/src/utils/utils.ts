/* eslint-disable no-console */
import crypto from 'crypto';
import fetch from 'node-fetch';
import * as Sentry from '@sentry/node';
import { SOURCES_DATA } from '../../config/actors';
import { localesToImport } from '../../config/primary-locales';
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

// Function to determine tolerance multiplier based on couponCount
export function getToleranceMultiplier(couponCount: number): number {
  if (couponCount < 10) return 3; // 300% tolerance
  if (couponCount < 20) return 1; // 100% tolerance
  if (couponCount < 50) return 0.5; // 50% tolerance
  if (couponCount < 100) return 0.3; // 30% tolerance
  if (couponCount < 500) return 0.2; // 20% tolerance

  return 0.1; // 10% tolerance
}

// Function to remove duplicate coupons
export function removeDuplicateCoupons(data: any) {
  const seen = new Set();
  const dataArray = Object.values(data);
  return dataArray.reduce((acc: any[], item: any) => {
    const keyString =
      item?.__url +
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
  const AVG_ITEMS_PER_RESULTS = 25;
  return (
    PRICE_PER_1000_RESULTS_IN_USD *
    (totalResults / AVG_ITEMS_PER_RESULTS) *
    1000
  );
}

// Function to get locale from url
export function getLocaleFromUrl(url: string): string | null {
  // find if url is present in any domain of SOURCES_DATA
  const source = SOURCES_DATA.find((source: any) =>
    source.domains.some((d: any) => url.includes(`${d.domain}/`))
  );

  if (source) {
    const domain = source.domains.find((d: any) =>
      url.includes(`${d.domain}/`)
    );
    if (domain) {
      if (domain.routes && Object.keys(domain.routes).length > 0) {
        const route = Object.keys(domain.routes).find((key) =>
          url.includes(`${domain.domain}${key}`)
        );
        if (route) {
          return domain.routes[route];
        }
        Sentry.captureMessage(`Route not found for url: ${url}`);
        return null;
      }
      return domain.locales[0];
    }
  }
  Sentry.captureMessage(`Domain not found for url: ${url}`);
  return null;
}

// Function to get country code from domain
export function isValidSourceDomain(domain: string): boolean {
  return SOURCES_DATA.some((source) =>
    source.domains.some((d) => domain === d.domain)
  );
}

// Function to check if locale is valid from primary locales
export function isValidLocale(locale: string): boolean {
  for (const l of localesToImport) {
    if (l.locale === locale) {
      return true;
    }
  }
  return false;
}

export function isValidCouponCode(code: string): boolean {
  // Check if the code has more than one space without separators
  if (
    code.split(' ').length > 1 &&
    !code.includes('|') &&
    !code.includes(',') &&
    !code.includes(' or ')
  ) {
    return false;
  }

  // Check if the code length is less than 2 or more than 32
  if (code.length < 2 || code.length > 32) {
    return false;
  }

  // Check if the code has more than one asterisk
  if (code.split('').filter((char) => char === '*').length > 1) {
    return false;
  }

  // Check if the code starts with "https://" or "http://"
  if (code.startsWith('https://') || code.startsWith('http://')) {
    return false;
  }

  // Check if the code contains any invalid words from the dictionary and has more than one space
  const invalidWords = [
    'zur',
    'nach',
    'kein',
    'sign',
    'signup',
    'sign-up',
    'via',
    'singing',
    'redeem',
    'inbox',
    'wird',
    'mehr',
    'customers',
    'direkt',
    'abgezogen',
    'newsletter',
    'details',
    'nieuwsbrief',
    'will',
    'claim',
    'code',
    'registro',
    'nyhedsbrevet',
    'tilmeld',
    'anmeldung',
    'siehe',
    'activated',
    'no',
    'coupon',
    'linkkiä',
    'link',
    'e-mail',
    'email',
    'per',
    'direkt abgezogen',
    'directamente',
    'automatico',
    'automatically',
    'aktionsprodukte entdecken',
    'als',
    'directo',
    'app ',
    'auf',
    'automatisch',
    'bei',
    'für',
    'bliv medlem',
    'downloaden',
    'genius discount',
    'genius rabatt',
    'geschäftskunden',
    'geschenkkarten',
    'geschenkkarte',
    'tilaa',
    'zie',
    'zum',
    'mit',
    'im',
    'register',
    'member',
    'liity',
    'membership',
  ];

  for (const word of invalidWords) {
    if (code.toLowerCase().includes(word) && code.split(' ').length > 1) {
      return false;
    }
  }

  // If none of the invalid criteria match, the code is valid
  return true;
}

export async function availableActorRuns(): Promise<number> {
  try {
    const RAM_GB_PER_ACTOR = 4;
    const MAX_CONCURRENT_RUNS = Number(process.env.MAX_CONCURRENT_RUNS);
    const APIFY_GET_ALL_RUNS_URL = `https://api.apify.com/v2/users/me/limits?token=${process.env.APIFY_ORG_TOKEN_OBERST}`;

    const response = await fetch(APIFY_GET_ALL_RUNS_URL, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error('🚫 Failed to fetch actor limits');
      return 0;
    }

    const apifyAccountLimit: any = await response.json();
    const {
      activeActorJobCount,
      actorMemoryGbytes,
    } = apifyAccountLimit.data.current;
    const {
      maxConcurrentActorJobs,
      maxActorMemoryGbytes,
    } = apifyAccountLimit.data.limits;

    if (
      MAX_CONCURRENT_RUNS <= 0 ||
      MAX_CONCURRENT_RUNS > maxConcurrentActorJobs
    ) {
      console.log('🚫 Invalid MAX_CONCURRENT_RUNS value');
      return 0;
    }

    if (actorMemoryGbytes >= maxActorMemoryGbytes) {
      console.log('🚫 Actor memory limit reached');
      return 0;
    }

    if (
      activeActorJobCount >= maxConcurrentActorJobs ||
      activeActorJobCount >= MAX_CONCURRENT_RUNS
    ) {
      console.log('🚫 Actor concurrency limit reached');
      return 0;
    }

    const availableMemory = maxActorMemoryGbytes - actorMemoryGbytes;
    const availableRuns = Math.min(
      MAX_CONCURRENT_RUNS - activeActorJobCount,
      Math.floor(availableMemory / RAM_GB_PER_ACTOR)
    );

    return availableRuns;
  } catch (error) {
    console.error('🚫 Error fetching actor runs', error);
    throw error;
  }
}

export function findMerchantBySearchTerm(
  searchTerm: string,
  merchants: any[]
): any {
  // Sort merchants by name length in descending order
  const sortedMerchants = merchants.sort(
    (a, b) => b.name.length - a.name.length
  );

  // Return the first merchant whose name is a prefix of the searchTerm
  return (
    sortedMerchants.find((merchant) => searchTerm.startsWith(merchant.name)) ||
    null
  );
}

export function getEndpointBaseUrl(): string {
  const port = process.env.PORT || 3000;
  return process.env.NODE_ENV === 'production'
    ? `http://localhost:${port}/`
    : process.env.BASE_URL || '';
}
