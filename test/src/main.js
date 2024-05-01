import { ApifyClient } from 'apify-client';
import { Template } from './fileReader.js';
import { testConfig } from '../testConfig.js';
// Initialize the ApifyClient with your Apify API token
const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

if (testConfig.length == 0) {
  throw new Error('To start testing actor add input to testConfig file');
}
(async () => {
  try {
    // Prepare Actor testing input
    for (const config of testConfig) {
      const input = {
        testSpec: Template,
        customData: {
          actorId: config.actorId,
          startUrls: config.startUrls,
        },
        testName: config.testName,
        slackChannel: '#public-actors-tests-notifications',
        slackPrefix: '@lead-dev @actor-owner',
      };
      const run = await client.actor('pocesar/actor-testing').call(input);
      console.info(`${run.status} - ${config.testName}`);
      console.info(
        `Check details https://console.apify.com/organization/${run.userId}/actors/${config.actorId}/runs/${run.id}#log`
      );
    }
  } catch (e) {
    console.error(e);
  }
})();
