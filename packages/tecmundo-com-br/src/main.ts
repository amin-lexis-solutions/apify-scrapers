import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.coupons__item', '.coupons'],
    nonIndexPageSelectors: ['.card-categories-index', '.card-shops-index'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
