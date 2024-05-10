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
import { prisma } from '../lib/prisma';
import {
  StandardResponse,
  RunTestBody,
  ListTestRequestBody,
  TestRequestBody,
} from '../utils/validators';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

@JsonController('/tests')
@Authorized()
@OpenAPI({ security: [{ bearerAuth: [] }] })
export class TestController {
  @Get('/')
  @OpenAPI({
    summary: 'List tests',
    description: 'Get a list of tests with pagination and optional filtering',
  })
  @ResponseSchema(StandardResponse)
  async getList(@QueryParams() params: ListTestRequestBody) {
    const { page, pageSize, actorId } = params;

    const offset = (page - 1) * pageSize;

    const [totalResults, data] = await Promise.all([
      prisma.test.count({}),
      prisma.test.findMany({
        skip: offset,
        take: pageSize,
        where: {
          OR: [{ apifyActorId: actorId }],
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

  @Post('/run')
  @OpenAPI({
    summary: 'Schedule actor test',
    description: 'Actor testing',
  })
  @ResponseSchema(StandardResponse)
  async scheduleActors(@Body() params: RunTestBody) {
    const { actors } = params;

    const actorsIds: string[] = [];

    actors.forEach((element) => {
      actorsIds.push(element?.actorId);
    });

    const source = await prisma.source.findMany({
      where: { apifyActorId: { in: actorsIds } },
    });

    if (source.length == 0) {
      throw new BadRequestError('Actors not found.');
    }

    let actorsAdded = 0;

    for (const actor of actors) {
      actorsAdded++;

      await prisma.test.create({
        data: {
          apifyActorId: actor.actorId,
          startUrls: actor.startUrls,
        },
      });
    }

    return new StandardResponse(
      `Added ${actorsAdded} actors to test`,
      false,
      {}
    );
  }

  @Post('/:id')
  @OpenAPI({
    summary: 'Tested actor',
    description: 'Actor testing',
  })
  @ResponseSchema(StandardResponse)
  async test(
    @Param('id') id: string,
    @Body() params: TestRequestBody
  ): Promise<StandardResponse> {
    if (!id || id.trim() === '') {
      throw new BadRequestError(
        'ID parameter is required and cannot be empty.'
      );
    }
    const { status, apifyRunId, lastApifyRunAt } = params;

    const existingTest = await prisma.test.findUnique({
      where: { id },
    });

    if (!existingTest) {
      throw new BadRequestError('Test not found.');
    }

    const updatedTest = await prisma.test.update({
      where: { id },
      data: { lastApifyRunAt, status, apifyRunId },
    });

    return new StandardResponse('Test saved successfully', false, {
      updatedTest: updatedTest,
    });
  }
}
