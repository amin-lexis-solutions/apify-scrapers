import { Reliability } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Authorized, Get, JsonController, Param } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { StandardResponse } from '../utils/validators';
import { SOURCES_DATA } from '../../config/actors';
import { localesToImport } from '../../config/primary-locales';
import dayjs from 'dayjs';

interface CouponSummaryRow {
  coupons: bigint;
  locale: string;
  domain: string;
  reliability: Reliability;
  proxyCountryCode: string | null;
  locale_active: boolean;
  source_active: boolean;
  itemsSeenLast24h: bigint;
}

interface TargetPagesRow {
  count: bigint;
  locale: string;
}
interface LocaleSummary {
  enabled: boolean;
  itemsCount: number;
  itemsSeenLast24h: number;
  targetPagesCount: number;
  domains: {
    domain: string;
    status: string;
    reliability: string;
    proxy: string | null;
    itemsCount: number;
    itemsSeenLast24h: number;
  }[];
}

@JsonController('/overview')
export class SummaryController {
  @Get('/scrape-stats')
  @OpenAPI({
    summary: 'Locales summary',
    description: 'Get a summary of the locales',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getSummary() {
    const result = await prisma.$queryRaw<CouponSummaryRow[]>`
      SELECT
          COUNT(c.id) AS coupons,
          tl.locale,
          sd.domain,
          sd.reliability,
          sd."proxyCountryCode",
          tl."isActive" as locale_active,
          s."isActive" as source_active,
          SUM(CASE WHEN c."lastSeenAt" >= now() - INTERVAL '1 day' THEN 1 ELSE 0 END) AS "itemsSeenLast24h"
      FROM
          "TargetLocale" tl
      LEFT JOIN
          "Coupon" c
      ON
          tl.locale = c.locale and c."lastSeenAt" > '2024-08-01 00:00:00'
      LEFT JOIN
          "SourceDomain" sd
      ON
          sd."domain" = c."sourceDomain"
      LEFT JOIN
          "Source" s
      ON
          s."apifyActorId" = c."apifyActorId"
      GROUP BY
          tl.locale,
          sd.domain,
          sd.reliability,
          sd."proxyCountryCode",
          tl."isActive",
          s."isActive";
    `;
    const sourceDomains = await prisma.sourceDomain.findMany({
      include: {
        source_relation: true,
      },
    });

    // Organize data into the desired format
    const localesSummary = result.reduce<Record<string, LocaleSummary>>(
      (acc, row) => {
        const {
          locale,
          domain,
          reliability,
          proxyCountryCode,
          coupons,
          itemsSeenLast24h,
          locale_active,
          source_active,
        } = row;

        if (!acc[locale]) {
          acc[locale] = {
            enabled: locale_active ? true : false,
            itemsCount: 0,
            itemsSeenLast24h: 0,
            targetPagesCount: 0,
            domains: [],
          };
        }

        acc[locale].itemsCount += Number(coupons);
        acc[locale].itemsSeenLast24h += Number(itemsSeenLast24h);

        if (domain != null)
          acc[locale].domains.push({
            domain,
            status: source_active ? 'active' : 'inactive',
            reliability:
              reliability === Reliability.reliable ? 'reliable' : 'unreliable',
            proxy: proxyCountryCode || null,
            itemsCount: Number(coupons),
            itemsSeenLast24h: Number(itemsSeenLast24h),
          });

        return acc;
      },
      {}
    );

    // add missing domains to related locales with 0 items
    const domains = SOURCES_DATA.flatMap((source: any) => source.domains);

    for (const domain of domains) {
      if (
        localesSummary[domain.locales[0]] &&
        !localesSummary[domain.locales[0]].domains.find(
          (d) => d.domain === domain.domain
        )
      ) {
        // get related source from sourceDomains table based on domain
        const source = sourceDomains.find((s) => s.domain === domain.domain);
        localesSummary[domain.locales[0]].domains.push({
          domain: domain.domain,
          status: source?.source_relation?.isActive ? 'active' : 'inactive',
          reliability:
            source?.reliability === Reliability.reliable
              ? 'reliable'
              : 'unreliable',
          proxy: source?.proxyCountryCode || null,
          itemsCount: 0,
          itemsSeenLast24h: 0,
        });
      }
    }

    // get count of targetPages for each locale
    const countTargetPages = await prisma.$queryRaw<TargetPagesRow[]>`
        SELECT  count(tp.*), tl."locale" from "TargetLocale" tl
        left join "TargetPage" tp
        on tp."localeId" = tl."id" and tp."domain" in (select "domain" from "SourceDomain")
        GROUP by tl."locale"
    `;
    // append localesSummary with count of targetPages
    countTargetPages.forEach((row) => {
      if (localesSummary[row.locale]) {
        localesSummary[row.locale].targetPagesCount = Number(row.count);
      }
    });

    return new StandardResponse(`Locales Summary`, false, {
      locales: localesSummary,
    });
  }

  @Get('/scrape-stats/:locale/:domain')
  @OpenAPI({
    summary: 'Locales summary',
    description: 'Get a summary of the locales',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getSummaryByLocaleAndDomain(
    @Param('locale') locale: string,
    @Param('domain') domain: string
  ) {
    // check if locale is valid
    if (!localesToImport.find((l) => l.locale === locale)) {
      return new StandardResponse('Invalid locale', true);
    }

    const sourceDomain = await prisma.sourceDomain.findFirst({
      select: { domain: true },
      where: { domain: domain },
    });

    if (!sourceDomain) {
      return new StandardResponse('Invalid source domain', true);
    }

    const result = await prisma.coupon.groupBy({
      by: ['sourceUrl', 'lastSeenAt', 'isExpired'],
      where: { locale, sourceDomain: sourceDomain.domain },
      _count: { _all: true },
      orderBy: {
        lastSeenAt: 'desc',
      },
    });

    // if no data found return empty response
    if (!result.length)
      return new StandardResponse(`Locales Summary`, false, {
        locale,
        totalItems: 0,
        nonExpiredItems: 0,
        totalTargetPages: 0,
        targetPagesList: [],
      });

    const totalItems = result.reduce((sum, row) => sum + row._count._all, 0);
    const nonExpiredItems = result
      .filter((row) => !row.isExpired)
      .reduce((sum, row) => sum + row._count._all, 0);

    const sourceUrls = new Set(result.map((row) => row.sourceUrl));
    const targetPagesMap = new Map<
      string,
      {
        url: string;
        lastCrawled: string | null;
        totalItems: number;
        nonExpiredItems: number;
      }
    >();

    result.forEach((row) => {
      const url = row.sourceUrl;
      if (!targetPagesMap.has(url)) {
        targetPagesMap.set(url, {
          url,
          lastCrawled: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
          totalItems: 0,
          nonExpiredItems: 0,
        });
      }
      const targetPage = targetPagesMap.get(url)!;
      targetPage.totalItems += row._count._all;

      if (row.lastSeenAt && !row.isExpired) {
        const lastCrawledAt = dayjs(row.lastSeenAt);
        const targetPageLastCrawled = targetPage.lastCrawled
          ? dayjs(targetPage.lastCrawled)
          : null;

        if (
          !targetPage.lastCrawled ||
          (targetPageLastCrawled &&
            lastCrawledAt.isAfter(targetPageLastCrawled))
        ) {
          targetPage.lastCrawled = lastCrawledAt.toISOString();
        }
        targetPage.nonExpiredItems += row._count._all;
      }
    });

    const relatedTargetPages = await prisma.targetPage.findMany({
      where: {
        domain: sourceDomain.domain,
        url: {
          notIn: Array.from(sourceUrls),
        },
      },
    });

    relatedTargetPages.forEach((row) => {
      if (!targetPagesMap.has(row.url)) {
        targetPagesMap.set(row.url, {
          url: row.url,
          lastCrawled: null,
          totalItems: 0,
          nonExpiredItems: 0,
        });
      }
    });

    const targetPagesList = Array.from(targetPagesMap.values()).map((page) => ({
      ...page,
      lastCrawled: page.lastCrawled
        ? page.lastCrawled.replace('T', ' ').replace('Z', ' UTC')
        : null,
    }));

    const totalTargetPages = sourceUrls.size + relatedTargetPages.length;

    const formattedResult = {
      locale,
      totalItems,
      nonExpiredItems,
      totalTargetPages,
      targetPagesList,
    };

    return new StandardResponse('Locales Summary', false, formattedResult);
  }
}
