import { Prisma } from '@prisma/client';
import {
  Authorized,
  BadRequestError,
  Body,
  Get,
  JsonController,
  Param,
  Post,
  QueryParams,
} from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { couponMatchCache } from '../lib/cache';
import { prisma } from '../lib/prisma';
import {
  CouponMatchRequestBody,
  ListRequestBody,
  StandardResponse,
  AnomalyRequestBody,
} from '../utils/validators';

@JsonController('/items')
export class CouponsController {
  @Get('/')
  @OpenAPI({
    summary: 'List items',
    description: 'Get a list of items with pagination and optional filtering',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getList(
    @QueryParams() params: ListRequestBody
  ): Promise<StandardResponse> {
    const {
      page,
      pageSize,
      archived,
      merchantDomain,
      merchantName,
      sourceName,
      sourceDomain,
      locale,
      type,
    } = params;

    const where: Prisma.CouponWhereInput = {};

    if (merchantName) {
      where.merchantName = merchantName;
    }

    if (sourceName) {
      where.source = { name: sourceName };
    }

    if (archived) {
      where.archivedAt = archived ? { not: null } : null;
    }

    if (type !== 'all') {
      where.code = type === 'code' ? { not: null } : { equals: null };
    }

    const domain = merchantDomain;

    if (domain) {
      where.domain = domain;
    }

    if (sourceDomain) {
      where.sourceUrl = {
        contains: sourceDomain,
      };
    }

    if (locale) {
      where.locale = locale;
    }

    const offset = (page - 1) * pageSize;
    const [totalResults, data] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        skip: offset,
        take: pageSize,
        where: where,
        include: {
          source: true,
        },
      }),
    ]);

    const lastPage = Math.ceil(totalResults / pageSize);
    const currentPageResults = data.length;

    return new StandardResponse(
      `Success! ${totalResults} total results found. Showing page ${page} of ${lastPage}`,
      false,
      {
        totalResults,
        currentPageResults,
        currentPage: page,
        lastPage,
        results: data,
      }
    );
  }

  @Post('/match-ids')
  @OpenAPI({
    summary: 'Check if a set of coupons exists by ID',
    description:
      'Returns an array of indices of coupons that exist. For example, if you pass in 5 IDs and ids at index 0, 2, and 4 exist, the response will be [0, 2, 4]',
  })
  async matchCoupons(@Body() params: CouponMatchRequestBody) {
    const { ids } = params;

    const cachedIds: string[] = [];
    const uncachedIds: string[] = [];

    ids.forEach((id) => {
      if (couponMatchCache.has(id)) {
        cachedIds.push(id);
      } else {
        uncachedIds.push(id);
      }
    });

    const coupons =
      uncachedIds.length > 0
        ? await prisma.coupon.findMany({
            where: { id: { in: uncachedIds } },
            select: { id: true },
          })
        : [];

    coupons.forEach((coupon) => {
      couponMatchCache.set(coupon.id, true);
    });

    return ids
      .map((id, idx) => (cachedIds.includes(id) ? idx : -1))
      .filter((idx) => idx !== -1);
  }

  @Post('/archive/:id')
  @OpenAPI({
    summary: 'Archive a record',
    description: 'Archive a record by ID',
  })
  @Authorized()
  @ResponseSchema(StandardResponse)
  async archive(@Param('id') id: string): Promise<StandardResponse> {
    if (!id || id.trim() === '') {
      throw new BadRequestError(
        'ID parameter is required and cannot be empty.'
      );
    }

    const existingRecord = await prisma.coupon.findUnique({
      where: { id },
    });

    if (!existingRecord) {
      throw new BadRequestError('Record not found.');
    }

    if (existingRecord.archivedAt) {
      const archivedDate = existingRecord.archivedAt.toISOString();

      return new StandardResponse(
        `Record already archived on ${archivedDate}. No changes done.`,
        false,
        { existingRecord: existingRecord }
      );
    }

    const updatedRecord = await prisma.coupon.update({
      where: { id },
      data: { archivedAt: new Date(), archivedReason: 'manual' },
    });

    return new StandardResponse('Record archived successfully', false, {
      updatedRecord: updatedRecord,
    });
  }

  @Post('/anomaly-detector')
  @OpenAPI({
    summary: 'Detect anomalies in coupon data',
    description: 'Detect anomalies in coupon data based on historical data.',
  })
  @ResponseSchema(StandardResponse)
  async detectAnomalies(@Body() body: AnomalyRequestBody) {
    const { sourceUrl, couponsCount } = body;

    // Validate the input
    if (!sourceUrl || couponsCount === undefined) {
      throw new BadRequestError('sourceUrl and couponCount must be provided');
    }

    try {
      // Retrieve the latest stats for the source
      const stats = await prisma.couponStats.findFirst({
        where: { sourceUrl },
        orderBy: { createdAt: 'desc' },
      });

      if (!stats) {
        return new StandardResponse(
          'No historical data found for the source',
          false,
          {
            anomalyType: null,
            plungeThreshold: null,
            surgeThreshold: null,
          }
        );
      }

      let anomalyType = null;
      if (couponsCount > stats.surgeThreshold) {
        anomalyType = 'Surge';
      } else if (couponsCount < stats.plungeThreshold) {
        anomalyType = 'Plunge';
      }

      if (anomalyType) {
        return new StandardResponse(
          `Anomaly detected: ${anomalyType} in coupon data`,
          true,
          {
            anomalyType,
            plungeThreshold: stats.plungeThreshold,
            surgeThreshold: stats.surgeThreshold,
          }
        );
      }

      return new StandardResponse(
        'No anomalies detected in coupon data',
        false,
        {
          anomalyType: null,
          plungeThreshold: stats.plungeThreshold,
          surgeThreshold: stats.surgeThreshold,
        }
      );
    } catch (error: any) {
      console.error('An error occurred in anomaly detection', error);
      return new StandardResponse('An error occurred ', true);
    }
  }
}
