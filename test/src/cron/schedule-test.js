import { Template } from '../fileReader.js';
import { testConfig } from '../../testConfig.js';

const APIFY_RUN_TEST = `https://api.apify.com/v2/acts/pocesar~actor-testing/run-sync?token=${process.env.APIFY_TOKEN}`;
const maxConcurrentTests = process.env.MAX_CONCURRENT_TESTS || 5;

const runTest = async ({ actorId, startUrls, testName }) => {
  try {
    await fetch(APIFY_RUN_TEST, {
      method: 'POST',
      body: JSON.stringify({
        testSpec: Template,
        customData: {
          actorId: actorId,
          startUrls: startUrls,
        },
        testName: testName,
        slackChannel: '#public-actors-tests-notifications',
        slackPrefix: '@lead-dev @actor-owner',
        defaultTimeout: 1200000,
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
  } catch (e) {
    console.log(e);
  }
};

(async () => {
  try {
    const runningTests = [];

    for (const obj of testConfig) {
      if (runningTests.length >= maxConcurrentTests) {
        throw new Error(
          `Limit the number of concurrent tests ${maxConcurrentTests}`
        );
      }

      await runTest(obj);
      runningTests.push(obj);
    }
  } catch (e) {
    console.log(e);
  }
})();
