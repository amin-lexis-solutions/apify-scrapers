import {
  Authorized,
  Get,
  JsonController,
  QueryParam,
} from 'routing-controllers';

import { StandardResponse } from '../utils/validators';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { prisma } from '@api/lib/prisma';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';

@JsonController('/dashboard')
export class DashboardController {
  @Get('/runs')
  @OpenAPI({
    summary: 'Processed runs summary',
    description: 'Processed runs summarizing the results over days',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getRuns(@QueryParam('endDate') endDate?: string) {
    // Default to today if no endDate is provided
    const today = new Date();
    const end = endDate ? dayjs(endDate) : dayjs(today);
    const startDate = end.subtract(1, 'day');

    const [sources, runs] = await Promise.all([
      prisma.source.findMany({
        select: {
          apifyActorId: true,
          name: true,
        },
      }),
      prisma.processedRun.groupBy({
        by: ['apifyActorId'],
        where: {
          startedAt: {
            gte: startDate.toDate(),
            lt: end.toDate(),
          },
        },
        _sum: {
          resultCount: true,
          errorCount: true,
          createdCount: true,
          updatedCount: true,
          archivedCount: true,
        },
        _max: {
          status: true,
          startedAt: true,
        },
      }),
    ]);

    // Combine source data with processedRun data
    const processedRuns = runs?.map((run: any) => {
      const source = sources?.filter(
        (source: any) => source.apifyActorId == run.apifyActorId
      )[0]?.name;

      return {
        name: source,
        ...run,
      };
    });

    const data = processedRuns?.sort((a: any, b: any) => {
      const dateA = new Date(a?._max?.startedAt)?.getTime();
      const dateB = new Date(b?._max?.startedAt)?.getTime();
      return dateB - dateA; // Sort descending by date
    });

    return new StandardResponse(
      `Success! ${data.length} total results found.`,
      false,
      {
        total: data.length,
        results: data,
        pagination: {
          previousDay: startDate.toDate(),
        },
      }
    );
  }
  @Get('/actors')
  @OpenAPI({
    summary: 'Actor summary',
    description: 'Retrieves actors showing processed runs for today',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getActors(
    @QueryParam('actor') actor?: string,
    @QueryParam('status') status?: string
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Set the previous day
    const previousDay = dayjs(today);
    previousDay.subtract(1, 'day');

    const sourceFilter: Prisma.SourceWhereInput = {
      name: actor ? { contains: actor, mode: 'insensitive' } : undefined,
    };

    // Fetch sources
    const sources = await prisma.source.findMany({
      orderBy: {
        name: 'asc',
      },
      where: sourceFilter,
      select: {
        id: true,
        name: true,
        lastRunAt: true,
        apifyActorId: true,
        runs: {
          where: {
            status,
            startedAt: {
              gt: today,
            },
          },
          select: {
            status: true,
            resultCount: true,
            errorCount: true,
            startedAt: true,
          },
        },
      },
    });

    const apifyActorIds = sources.map((source) => source.apifyActorId);

    // Fetch tests for apifyActorIds
    const tests = await prisma.test.findMany({
      where: {
        apifyActorId: { in: apifyActorIds },
      },
    });

    const data = await Promise.all(
      sources.map(async (source) => {
        let processedRun: any = source.runs?.[0] || null;

        // If no processed run for today, check for the previous day
        if (!processedRun) {
          const previousRun = await prisma.processedRun.findFirst({
            where: {
              apifyActorId: source.apifyActorId,
              status,
            },
            select: {
              status: true,
              resultCount: true,
              errorCount: true,
              startedAt: true,
            },
          });

          processedRun = previousRun || {};
        }

        const test = tests.find(
          (test) => test.apifyActorId === source.apifyActorId
        );

        return {
          ...source,
          lastRunAt: processedRun.startedAt,
          runs: processedRun ? processedRun : {},
          test,
        };
      })
    );

    const results = status
      ? data.filter((source) => source.runs?.status == status)
      : data;

    return new StandardResponse(`Actors results`, false, {
      total: results.length,
      results,
    });
  }
  @Get('/items-breakdown')
  @OpenAPI({
    summary: 'Items by breaking them down into expired and active ',
    description:
      'Retrieves a breakdown of coupon statuses by counting how many are expired and how many are still active.',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getBreakdown() {
    const now = new Date();

    const [expiredCount, activeCount] = await Promise.all([
      prisma.coupon.count({
        where: {
          OR: [
            {
              archivedAt: { not: null },
            },
            {
              AND: [
                { expiryDateAt: { not: null } },
                { expiryDateAt: { lt: now } },
              ],
            },
            {
              isExpired: true,
            },
            {
              isShown: false,
            },
          ],
        },
      }),
      prisma.coupon.count({
        where: {
          OR: [
            {
              expiryDateAt: { gt: now },
            },
            {
              archivedAt: { gt: now },
            },
            {
              isExpired: false,
            },
          ],
        },
      }),
    ]);

    return new StandardResponse(`Items breakdown results`, false, {
      results: {
        expiredCount,
        activeCount,
      },
    });
  }

  @Get('/items-targets-stats')
  @OpenAPI({
    summary:
      'Retrieves items and targets count summarizing the results over the past 30 days',
    description:
      'The results are grouped by date, summing up the count for each unique day, and are ordered by date for both items and targets',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getItemsAndTargets() {
    const today = new Date();
    const startDate = dayjs(today).subtract(29, 'day').toDate();

    const [itemsResults, targetsResults]: any = await Promise.all([
      prisma.$queryRaw`
        SELECT 
          DATE("startedAt") AS "date", 
          SUM("resultCount") AS "count"
        FROM "ProcessedRun" 
        WHERE "startedAt" BETWEEN ${startDate} AND ${today}
        GROUP BY DATE("startedAt") 
        ORDER BY DATE("startedAt");
      `,
      prisma.$queryRaw`
        SELECT 
          DATE("createdAt") AS "date", 
          COUNT("sourceUrl") AS "count"
        FROM "CouponStats" 
        WHERE "createdAt" BETWEEN ${startDate} AND ${today}
        GROUP BY DATE("createdAt") 
        ORDER BY DATE("createdAt");
      `,
    ]);

    const chartData = {
      dates: itemsResults.map((item: any) => item.date),
      items: itemsResults.map((item: any) => Number(item.count)),
      targets: targetsResults.map((target: any) => Number(target.count)),
    };

    return new StandardResponse(`Items and targets results`, false, {
      results: chartData,
    });
  }
}
