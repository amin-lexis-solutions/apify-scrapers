import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { StandardResponse, RunTestBody } from '../utils/validators';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { testSpec } from '../test/actors/specs/dynamicTemplate.spec';
import path from 'path';
import { readFileSync } from 'fs';
import { prisma } from '@api/lib/prisma';
@JsonController('/tests')
@Authorized()
@OpenAPI({ security: [{ bearerAuth: [] }] })
export class TestController {
  @Post('/run')
  @OpenAPI({
    summary: 'Run testing actor',
    description: 'Run testing actor for active scrapers',
  })
  @ResponseSchema(StandardResponse)
  async scheduleActors(@Body() params: RunTestBody) {
    const { maxConcurrency } = params;

    try {
      const configJson = readFileSync(
        path.resolve(__dirname, '../test/actors/config.json'),
        'utf-8'
      );
      const testList = JSON.parse(configJson);
      let runningTests = 0;

      for (const id in testList) {
        if (maxConcurrency <= runningTests) {
          console.log(
            `Already scheduled the maximum ${maxConcurrency} number of actors. Skipping test`
          );
          break;
        }
        // Apify testing actor input
        const input = {
          testSpec,
          customData: {
            actorId: id,
            startUrls: testList[id],
          },
          testName: `Test actor ${id}`,
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
        // Call apify testing actors
        const response = await fetch(
          `https://api.apify.com/v2/acts/pocesar~actor-testing/runs?token=${process.env.API_KEY_APIFY}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          }
        );
        // Apify testing result
        const result = await response.json();
        // Record test data
        await prisma.test.create({
          data: {
            apifyActorId: id,
            apifyTestRunId: result.data.id,
            status: result.data.status,
          },
        });
        runningTests++;
        console.log(`Running apify testing actor - runId ${result.data.id}`);
      }
      return new StandardResponse(
        `Apify testing actor runs sucessfully ${runningTests} tests`,
        false
      );
    } catch (e) {
      console.log(e);
    }
  }
}
