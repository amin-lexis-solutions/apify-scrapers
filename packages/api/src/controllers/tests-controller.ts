import * as Sentry from '@sentry/node';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { StandardResponse, RunTestBody } from '../utils/validators';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { testSpec } from '../test/actors/specs/dynamicTemplate.spec';
import path from 'path';
import { readFileSync } from 'fs';
import { prisma } from '@api/lib/prisma';
import dayjs from 'dayjs';
import { apify } from '@api/lib/apify';

function getTestConfigJson() {
  const configJson = readFileSync(
    path.resolve(__dirname, '../test/actors/config.json'),
    'utf-8'
  );
  return JSON.parse(configJson);
}

export function generateApifyTestingActorInput(
  actorId: string,
  startUrls: any
) {
  // Apify testing actor input
  return {
    testSpec,
    customData: {
      actorId,
      startUrls,
    },
    testName: `Test actor ${actorId}`,
    slackChannel: '#public-actors-tests-notifications',
    slackPrefix: '@lead-dev @actor-owner',
    // defaultTimeout apify testing actor
    defaultTimeout: 120000,
    verboseLogs: true,
    abortRuns: true,
    filter: [],
    email: '',
    retryFailedTests: false,
  };
}

@JsonController('/tests')
@Authorized()
@OpenAPI({ security: [{ bearerAuth: [] }] })
export class TestsController {
  @Post('/run')
  @OpenAPI({
    summary: 'Run testing actor',
    description: 'Run testing actor for active scrapers',
  })
  @ResponseSchema(StandardResponse)
  async scheduleActors(@Body() params: RunTestBody) {
    const { maxConcurrency } = params;

    try {
      const actorIdToStartingUrlsMapping = getTestConfigJson();

      const lastTestRuns = await prisma.test.groupBy({
        by: ['apifyActorId'],
        where: {
          lastRunAt: { gt: dayjs().subtract(7, 'days').toDate() },
        },
      });

      // Skip last tests from testActorIdToStartingUrlsMapping
      lastTestRuns?.map(
        (test) => delete actorIdToStartingUrlsMapping[test?.apifyActorId]
      );

      let runningTestsCount = 0;

      // Mapping actorIds
      for (const actorId in actorIdToStartingUrlsMapping) {
        if (maxConcurrency <= runningTestsCount) {
          console.log(
            `Already running the maximum ${maxConcurrency} number of tests.`
          );
          break;
        }

        const testingActorInput = generateApifyTestingActorInput(
          actorId,
          actorIdToStartingUrlsMapping[actorId]
        );

        await apify
          .actor('pocesar/actor-testing')
          .start(testingActorInput, {
            webhooks: [
              {
                eventTypes: [
                  'ACTOR.RUN.SUCCEEDED',
                  'ACTOR.RUN.FAILED',
                  'ACTOR.RUN.TIMED_OUT',
                  'ACTOR.RUN.ABORTED',
                ],
                requestUrl: `${process.env.BASE_URL}webhooks/tests`,
                payloadTemplate: `{"actorId":"${actorId}","resource":{{resource}},"eventData":{{eventData}}}`,
                headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
              },
            ],
          })
          .then(() => {
            console.log(`Started test for ${actorId}`);
          })
          .catch((e) => {
            Sentry.captureMessage(
              `Error starting test for actor ${actorId} - error: ${JSON.stringify(
                e
              )}`
            );
            return new StandardResponse('Error starting test', true, {
              error: e,
            });
          });
        runningTestsCount++;
      }
      return new StandardResponse(
        `Test started for ${runningTestsCount} actors`,
        false
      );
    } catch (e) {
      console.log(e);
    }
  }
}
