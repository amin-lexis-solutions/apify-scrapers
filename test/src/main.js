import { ApifyClient } from 'apify-client';
import { createTest, inputValidator } from './utils/testTemplate.js';
import { testConfig } from './input.js';
// Initialize the ApifyClient with your Apify API token
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

(async () => {
  try {
    const inputConfig = inputValidator(testConfig);

    inputConfig?.map(async (inputObj) => {
      // Create test input object
      const test = await createTest(
        inputObj.actorId,
        inputObj.input,
        inputObj.testName,
        inputObj.slackChannel,
        inputObj.slackPrefix
      );
      // Run the Actor and wait for it to finish
      const run = await client.actor('pocesar/actor-testing').call(test);

      console.log(`Test ${run.status} - actorID ${inputObj.actorId} `);
      console.log(
        `💾 Check your data here: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`
      );
    });
  } catch (e) {
    console.error(e);
  }
})();
