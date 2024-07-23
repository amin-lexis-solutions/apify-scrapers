import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.coupon-list', '.storeHeader-logo'],
    nonIndexPageSelectors: ['.category-list', '.featured-item'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
