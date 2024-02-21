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
} from '../utils/validators';

@JsonController('/coupons')
export class CouponsController {
  @Get('/')
  @OpenAPI({
    summary: 'List items',
    description: 'Get a list of items with pagination and optional filtering',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ token: [] }] })
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

    const domain = merchantDomain;

    if (domain) {
      where.domain = domain;
    }

    if (sourceDomain) {
      where.sourceUrl = {
        contains: sourceDomain,
      };
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
}
