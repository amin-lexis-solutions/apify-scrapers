import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    domain: 'www.kortingscode.nl',
    countryCode: 'nl',
  });

  await crawler.run();
  await Actor.exit();
}

main();
