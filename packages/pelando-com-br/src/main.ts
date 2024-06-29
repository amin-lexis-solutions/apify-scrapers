import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['#store-coupons', 'ul.sc-a8fe2b69-0'],
    nonIndexPageSelectors: ['.sc-a4b5c454-0', '#feed-tabs-container'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
