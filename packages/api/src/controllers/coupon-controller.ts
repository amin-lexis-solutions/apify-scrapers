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

  @Post('/match')
  @OpenAPI({
    summary: 'Check if a set of coupons exists by ID',
  })
  async matchCoupons(@Body() params: CouponMatchRequestBody) {
    const { ids } = params;

    const coupons = await prisma.coupon.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    return ids.map((id) => {
      return !!coupons.find((coupon) => coupon.id === id);
    });
  }
}
