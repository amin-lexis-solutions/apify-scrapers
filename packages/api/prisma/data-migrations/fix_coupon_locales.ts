import { PrismaClient } from '@prisma/client';
import ProgressBar from 'progress';
import {
  getCountryCodeFromDomain,
  detectLanguage,
  getAccurateLocale,
} from './utils';
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
  };

  const coupons = await prisma.coupon.findMany({
    // take: 100,
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

  const locales = await prisma.targetLocale.findMany({
    select: {
      locale: true,
      countryCode: true,
      languageCode: true,
    },
  });
  const batchSize = 1000;
  const bar = new ProgressBar('Processing [:bar] :percent :etas', {
    total: Math.ceil(coupons.length / batchSize),
    width: 40,
  });

  for (let i = 0; i < coupons.length; i += batchSize) {
    const batch = coupons.slice(i, i + batchSize);

    const langCodes = await Promise.all(
      batch.map(
        async (coupon) =>
          await detectLanguage(`${coupon.title}  ${coupon.description}`)
      )
    );

    await prisma.$transaction(
      batch.map((coupon, index) => {
        const targetPage = targetPages.find(
          (tp) => tp.url === coupon.sourceUrl
        );

        let countryCode = getCountryCodeFromDomain(coupon.sourceUrl || '');

        // If the country code could not be determined from the domain, try to extract it from the source URL.
        if (!countryCode) {
          countryCode = getCountryCodeFromDomain(coupon.domain || '');
        }

        const langCode = langCodes[index] || '';

        const accurateLocale = getAccurateLocale(
          targetPage?.locale?.locale || '',
          countryCode || '',
          langCode || '',
          coupon.locale || '',
          locales
        );

        if (
          targetPage?.locale.locale !== coupon.locale &&
          targetPage?.url !== coupon.sourceUrl
        ) {
          stats.couponsNotMatchTargetPageAndLocale.push(coupon.id);
        } else if (targetPage?.locale.locale !== coupon.locale) {
          stats.couponsNotMatchTargetPageLocale.push(coupon.id);
        } else if (targetPage?.url !== coupon.sourceUrl) {
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
            `Coupon Match Base URL [TP locale]: ${targetPage?.locale.locale} : [COUPON locale]: ${coupon.locale}`
          );

          console.log(
            `Coupon Match Domain Country Code ${countryCode} [Domain]: ${coupon.domain} : [COUPON locale]: ${coupon.locale}`
          );

          console.log(
            `Coupon Match Language Detection ${langCode} : [COUPON Locale]: ${coupon.locale}`
          );

          console.log(coupon.title + ' ' + coupon.description);

          console.log(
            `Coupon Match Most Common Locale [Final locale]: ${accurateLocale} : [COUPON Locale]: ${coupon.locale}`
          );
        }

        return prisma.coupon.update({
          where: { id: coupon.id },
          data: {
            locale: UPDATE ? accurateLocale : coupon.locale,
          },
        } as any);
      })
    );
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
