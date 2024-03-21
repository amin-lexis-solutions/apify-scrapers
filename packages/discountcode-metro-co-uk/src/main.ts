import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    domain: 'discountcode.metro.co.uk',
    countryCode: 'uk',
  });

  await crawler.run();
  await Actor.exit();
}

main();
