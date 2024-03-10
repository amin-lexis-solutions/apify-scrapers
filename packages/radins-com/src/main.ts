import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next_routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    domain: 'radins.com',
    countryCode: 'fr',
  });

  await crawler.run();
  await Actor.exit();
}

main();
