import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    domain: 'gutscheine.focus.de',
    countryCode: 'de',
  });

  await crawler.run();
  await Actor.exit();
}

main();
