import { Prisma, PrismaClient } from '@prisma/client';
import {
  Authorized,
  Get,
  JsonController,
  QueryParams,
} from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { ListRequestBody, StandardResponse } from '../utils/validators';

const prisma = new PrismaClient();

@JsonController()
@Authorized()
@OpenAPI({ security: [{ token: [] }] })
export class ListController {
  @Get('/list')
  @OpenAPI({
    summary: 'List items',
    description: 'Get a list of items with pagination and optional filtering',
  })
  @ResponseSchema(StandardResponse) // Apply @ResponseSchema at the method level
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

    if (locale && typeof locale === 'string' && locale.trim() !== '') {
      where.source = { sourceLocale: locale };
    }

    if (
      merchantName &&
      typeof merchantName === 'string' &&
      merchantName.trim() !== ''
    ) {
      where.merchantName = merchantName;
    }

    if (
      sourceName &&
      typeof sourceName === 'string' &&
      sourceName.trim() !== ''
    ) {
      where.source = { sourceName: sourceName };
    }

    if (archived) {
      where.archivedAt = archived ? { not: null } : null;
    }

    const domain = merchantDomain;

    if (domain && typeof domain === 'string' && domain.trim() !== '') {
      where.domain = domain;
    }

    if (
      sourceDomain &&
      typeof sourceDomain === 'string' &&
      sourceDomain.trim() !== ''
    ) {
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
}
