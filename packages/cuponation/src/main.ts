import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next_routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    extractDomainAndCountryCode: true,
  });

  await crawler.run();
  await Actor.exit();
}

main();
