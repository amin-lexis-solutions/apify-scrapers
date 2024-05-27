import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

// trigger github action change
async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    domain: 'discountcode.dailymail.co.uk',
    countryCode: 'uk',
  });

  await crawler.run();
  await Actor.exit();
}

main();
