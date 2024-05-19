import { testSpec } from '../test/actors/specs/dynamicTemplate.spec';

const maxConcurrentTests = Number(process.env.MAX_CONCURRENT_TESTS) || 5;

const APIFY_RUN_TEST = `https://api.apify.com/v2/acts/pocesar~actor-testing/runs?token=${process.env.APIFY_TOKEN}`;

async function findTests() {
  try {
    const response = await fetch(`${process.env.BASE_URL}tests/`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (process.env.API_SECRET as string),
      },
      method: 'GET',
    });
    const testList = await response?.json();

    return testList;
  } catch (e) {
    console.log(e);
  }
}

async function runTests(actorId: string, startUrls: string[]) {
  try {
    const response = await fetch(APIFY_RUN_TEST, {
      method: 'POST',
      body: JSON.stringify({
        testSpec: testSpec,
        customData: {
          actorId: actorId,
          startUrls: startUrls,
        },
        testName: `Test actor ${actorId}`,
        slackChannel: '#public-actors-tests-notifications',
        slackPrefix: '@lead-dev @actor-owner',
        defaultTimeout: 120000,
        verboseLogs: true,
        abortRuns: true,
        filter: [],
        email: '',
        retryFailedTests: false,
      }),
      headers: {
        'content-Type': 'application/json',
      },
    });

    const result = await response.json();

    return result;
  } catch (e) {
    console.log(e);
  }
}

(async () => {
  try {
    const scheduledTest = await findTests();

    let runningTests = 0;

    if (scheduledTest?.data?.results?.length == 0) {
      throw new Error('Test no found');
    }

    for (const obj of scheduledTest?.['data']?.['results']) {
      if (runningTests >= maxConcurrentTests) {
        throw new Error(
          `Limit the number of concurrent tests ${maxConcurrentTests}`
        );
      }

      runningTests++;

      const startUrls = obj.startUrls.map((item: string) => {
        return { url: item };
      });

      const result = await runTests(obj.apifyActorId, startUrls);

      await fetch(`${process.env.BASE_URL}tests/${obj.id}`, {
        method: 'POST',
        body: JSON.stringify({
          status: result['data']['status'],
          apifyRunId: result['data']['id'],
          lastApifyRunAt: result['data']['startedAt'],
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (process.env.API_SECRET as string),
        },
      });
    }
  } catch (e) {
    console.log(e);
  }
})();
