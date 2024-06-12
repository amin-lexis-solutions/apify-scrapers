import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';
import { getCountryCodeFromDomain } from './utils';
import { getLocaleFromUrl } from '@api/utils/utils';
import fs from 'fs';

const prisma = new PrismaClient();

// Set to true to update the coupon locales
const UPDATE = true;
// Set to true to enable debug logging
const DEBUG = false;

async function main() {
  console.log('Loading data...');

  const stats = {
    couponsNotMatchTargetPageUrl: [] as string[],
    couponsNotMatchTargetPageLocale: [] as string[],
    couponsNotMatchTargetPageAndLocale: [] as string[],
    couponsWithCorrectLocale: [] as string[],
    couponsToBeUpdated: [] as string[],
    correctTargetPageCount: 0,
    updatedCount: 0,
    constraintsCollisions: 0,
    undefinedLocale: 0,
  };

  const coupons = await prisma.coupon.findMany({
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      domain: true,
      description: true,
      locale: true,
    },
  });

  const targetPages = await prisma.targetPage.findMany({
    select: {
      id: true,
      url: true,
      locale: true,
    },
  });

  const targetPageUrlToLocale: Record<string, string> = {};

  targetPages.forEach((page) => {
    targetPageUrlToLocale[page.url] = page.locale.locale;
  });

  const batchSize = 1000;
  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: Math.ceil(coupons.length / batchSize),
    width: 40,
  });

  for (let i = 0; i < coupons.length; i += batchSize) {
    const batch = coupons.slice(i, i + batchSize);

    for (const coupon of batch) {
      const url = coupon.sourceUrl;
      const locale = targetPageUrlToLocale[url];

      let countryCode = getCountryCodeFromDomain(coupon.sourceUrl || '');

      if (!countryCode) {
        countryCode = getCountryCodeFromDomain(coupon.domain || '');
      }

      const accurateLocale =
        getLocaleFromUrl(coupon.sourceUrl || '') || coupon.locale;

      if (locale !== coupon.locale && url !== coupon.sourceUrl) {
        stats.couponsNotMatchTargetPageAndLocale.push(coupon.id);
      } else if (locale !== coupon.locale) {
        stats.couponsNotMatchTargetPageLocale.push(coupon.id);
      } else if (url !== coupon.sourceUrl) {
        stats.couponsNotMatchTargetPageUrl.push(coupon.id);
      } else {
        stats.correctTargetPageCount++;
      }

      if (coupon.locale === accurateLocale) {
        stats.couponsWithCorrectLocale.push(coupon.id);
      } else {
        stats.couponsToBeUpdated.push(coupon.id);
      }

      if (DEBUG) {
        console.log(`\n`);
        console.log(
          `Coupon Match Base URL [TP locale]: ${locale} : [COUPON locale]: ${coupon.locale}`
        );
        console.log(
          `Coupon Match Domain Country Code ${countryCode} [Domain]: ${coupon.domain} : [COUPON locale]: ${coupon.locale}`
        );
        console.log(coupon.title + ' ' + coupon.description);
        console.log(
          `Coupon Match Most Common Locale [Final locale]: ${accurateLocale} : [COUPON Locale]: ${coupon.locale}`
        );
      }

      try {
        if (UPDATE) {
          await prisma.coupon.update({
            where: { id: coupon.id },
            data: {
              locale: accurateLocale,
            },
          });
          stats.updatedCount++;
        }
      } catch (e) {
        if (DEBUG) {
          console.error(
            `Error updating coupon ${coupon.sourceUrl} locale "${coupon.locale}"  with locale ${accurateLocale}`
          );
        }

        if (coupon.locale && accurateLocale) {
          stats.constraintsCollisions++;
        }
        if (!accurateLocale) {
          stats.undefinedLocale++;
        }
      }
    }

    bar.tick();
  }

  console.log('Stats:');
  console.table({
    'Total Coupons Processed': coupons.length,
    'Coupons Matching Target Page URL': stats.correctTargetPageCount,
    'Coupons Not Matching (URL and Locale) in Target Pages':
      stats.couponsNotMatchTargetPageAndLocale.length,
    'Coupons Not Matching (URL) in Target Pages':
      stats.couponsNotMatchTargetPageUrl.length,
    'Locale Collisions Between Coupons and Target Pages':
      stats.couponsNotMatchTargetPageLocale.length,
    'Coupons with Correct Locale (No Changes Made)':
      stats.couponsWithCorrectLocale.length,
    'Coupons Affected by This Update': stats.couponsToBeUpdated.length,
    'Coupons Updated': stats.updatedCount,
    'Constraints Collisions': stats.constraintsCollisions,
    'Undefined Locale': stats.undefinedLocale,
  });

  fs.writeFileSync('coupon_locale_stats.json', JSON.stringify(stats, null, 2));
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
