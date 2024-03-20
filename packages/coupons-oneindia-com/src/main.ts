import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    domain: 'coupons.oneindia.com',
    countryCode: 'in',
  });

  await crawler.run();
  await Actor.exit();
}

main();
