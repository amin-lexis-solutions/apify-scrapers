import { Reliability } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Authorized, Get, JsonController } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { StandardResponse } from '../utils/validators';
import { SOURCES_DATA } from '../../config/actors';

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
}
