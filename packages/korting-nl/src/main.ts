import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.col_item.offer_grid'],
    nonIndexPageSelectors: ['.alphabet-filter', '.post_carousel_block'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
