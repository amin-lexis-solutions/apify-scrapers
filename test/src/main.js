import { ApifyClient } from 'apify-client';
import { createTest } from './template.js';
import { testConfig } from './example_inputs/config.js';

// Initialize the ApifyClient with your Apify API token
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

(async () => {

    testConfig.map(async (obj) => {
        const test = await createTest(obj.actorId, obj.input, obj.testName, obj.slackChannel, obj.slackPrefix);
        // Run the Actor and wait for it to finish
        const run = await client.actor("pocesar/actor-testing").call(test);

        console.log(`💾 Check your data here: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`);
        console.log(`Test ${run.status} - actorID ${obj.actorId} `);
    })

})();
