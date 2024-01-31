import { Prisma, PrismaClient } from '@prisma/client';
import {
  Authorized,
  Body,
  Get,
  JsonController,
  Post,
  QueryParams,
} from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { couponMatchCache } from '../lib/cache';
import {
  CouponMatchRequestBody,
  ListRequestBody,
  StandardResponse,
} from '../utils/validators';

const prisma = new PrismaClient();

@JsonController()
export class CouponController {
  @Get('/list')
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
      locale,
      archived,
      merchantDomain,
      merchantName,
      sourceName,
      sourceDomain,
    } = params;

    const where: Prisma.CouponWhereInput = {};

    if (locale) {
      where.source = { sourceLocale: locale };
    }

    if (merchantName) {
      where.merchantName = merchantName;
    }

    if (sourceName) {
      where.source = { sourceName: sourceName };
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
}
