import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.promotion-filter', '.promotion-list__promotions'],
    nonIndexPageSelectors: [
      '.merchant-list-header-container',
      ':not(.merchant-info__logo)',
    ],
  });

  await crawler.run();
  await Actor.exit();
}

main();
