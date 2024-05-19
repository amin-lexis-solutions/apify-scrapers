import { Template } from '../test/actors/fileReader';

const maxConcurrentTests = Number(process.env.MAX_CONCURRENT_TESTS) || 5;

const APIFY_RUN_TEST = `https://api.apify.com/v2/acts/pocesar~actor-testing/runs?token=${process.env.APIFY_TOKEN}`;

async function findTest() {
  try {
    const response = await fetch(`${process.env.BASE_URL}test/`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (process.env.API_SECRET as string),
      },
    });
    const testList = await response?.json();

    const testRun =
      testList?.data?.results?.filter(
        (item: any) => !item.status.includes('READY')
      ) || [];

    return testRun;
  } catch (e) {
    console.log(e);
  }
}

async function runTest(actorId: string, startUrls: string[]) {
  try {
    const response = await fetch(APIFY_RUN_TEST, {
      method: 'POST',
      body: JSON.stringify({
        testSpec: Template,
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
    const scheduledTest = await findTest();

    let runningTests = 0;

    if (scheduledTest.length == 0) {
      throw new Error('Test no found');
    }

    for (const obj of scheduledTest['data']['results']) {
      if (runningTests >= maxConcurrentTests) {
        throw new Error(
          `Limit the number of concurrent tests ${maxConcurrentTests}`
        );
      }

      runningTests++;

      const startUrls = obj.startUrls.map((item: string) => {
        return { url: item };
      });

      const result = await runTest(obj.apifyActorId, startUrls);

      await fetch(`${process.env.BASE_URL}test/${obj.id}`, {
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
