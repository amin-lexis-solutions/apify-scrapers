import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';

import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.storetop', '.codelist'],
    nonIndexPageSelectors: ['.pagination', '.tax_categories'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
