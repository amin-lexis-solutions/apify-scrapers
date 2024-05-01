import { ApifyClient } from 'apify-client';

// Initialize the ApifyClient with your Apify API token
const client = new ApifyClient({
  token: process.env.APIFY_TOKEN,
});

(async () => {
  try {
    // Prepare Actor input
    const input = {
      testSpec: ({
        it,
        xit,
        moment,
        _,
        run,
        expect,
        expectAsync,
        input,
        describe,
      }) => {
        (input.resource ? ['beta'] : ['latest']).forEach((build) => {
          describe(`${build} version`, () => {
            it('Call actor by id', async () => {
              const runResult = await run({
                // Picodi Com Scraper
                actorId: 'E0ttlQYLdG6AIOQZK',
                input: {
                  startUrls: [
                    {
                      url: 'https://www.picodi.com/sk/dx-racer',
                    },
                    {
                      url: 'https://www.picodi.com/au/drivemycar',
                    },
                    {
                      url: 'https://www.picodi.com/nz/pharmacy-direct',
                    },
                    {
                      url: 'https://www.picodi.com/ro/ehainele',
                    },
                    {
                      url: 'https://www.picodi.com/hu/xxxlutz',
                    },
                    {
                      url: 'https://www.picodi.com/ie/europcar',
                    },
                    {
                      url: 'https://www.picodi.com/ch/dosenbach',
                    },
                    {
                      url: 'https://www.picodi.com/pt/',
                    },
                    {
                      url: 'https://www.picodi.com/pl/mango',
                    },
                    {
                      url: 'https://www.picodi.com/it/tap-portugal',
                    },
                    {
                      url: 'https://www.picodi.com/co/jumbo',
                    },
                    {
                      url: 'https://www.picodi.com/se/stylepit',
                    },
                    {
                      url: 'https://www.picodi.com/fi/stylepit',
                    },
                    {
                      url: 'https://www.picodi.com/ch/deindeal',
                    },
                    {
                      url: 'https://www.picodi.com/my/romwe',
                    },
                    {
                      url: 'https://www.picodi.com/ae/tajawal',
                    },
                    {
                      url: 'https://www.picodi.com/es/easyjet',
                    },
                    {
                      url: 'https://www.picodi.com/ar/buquebus-ar',
                    },
                    {
                      url: 'https://www.picodi.com/sg/photobooksingapore',
                    },
                    {
                      url: 'https://www.picodi.com/mx/ebay',
                    },
                    {
                      url: 'https://www.picodi.com/br/tricae',
                    },
                  ],
                },
              });

              await expectAsync(runResult).toHaveStatus('SUCCEEDED');

              await expectAsync(runResult).withLog((log) => {
                expect(log)
                  .withContext(runResult.format('ReferenceError'))

                  .not.toContain('ReferenceError');

                expect(log)
                  .withContext(runResult.format('TypeError'))

                  .not.toContain('TypeError');
              });

              await expectAsync(runResult).withStatistics((stats) => {
                expect(stats.requestsRetries)
                  .withContext(runResult.format('Request retries'))

                  .toBeLessThan(25);

                expect(stats.crawlerRuntimeMillis)
                  .withContext(runResult.format('Run time'))

                  .toBeWithinRange(0.1 * 60000, 10 * 60000);
              });

              await expectAsync(runResult).withDataset(({ dataset, info }) => {
                expect(info.cleanItemCount)
                  .withContext(runResult.format('Dataset cleanItemCount'))

                  .toBeGreaterThan(0);

                expect(dataset.items)
                  .withContext(runResult.format('Dataset items array'))

                  .toBeNonEmptyArray();
              });
            });
          });
        });
      },

      slackChannel: '#public-actors-tests-notifications',

      slackPrefix: '@lead-dev @actor-owner',
    };
    const run = await client.actor('pocesar/actor-testing').call(input);
    console.log(`Actor testing status: ${run.status}`);
  } catch (e) {
    console.error(e);
  }
})();
