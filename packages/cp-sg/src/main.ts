// For more information, see https://crawlee.dev/
import { logger } from 'shared/logger';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';

import { router } from './routes';

async function main() {
  await Actor.init();
  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.store-listing-item'],
    nonIndexPageSelectors: ['.store-listing', '.category-parent'],
  });
  await crawler.run();
}

Actor.on('aborting', () => {
  logger.publish();
});

main()
  .catch((error) => {
    logger.error('Actor failed', { error });
  })
  .finally(async () => {
    await logger.publish();
    await Actor.exit();
  });
