import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.main-coupon-wrapper'],
    nonIndexPageSelectors: [
      '.all-selected-store-listing',
      '.view-deal-categories-new',
    ],
  });

  await crawler.run();
  await Actor.exit();
}

main();
