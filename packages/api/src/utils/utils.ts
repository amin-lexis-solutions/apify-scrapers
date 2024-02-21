import crypto from 'crypto';

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
