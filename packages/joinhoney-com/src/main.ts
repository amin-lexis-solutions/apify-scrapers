import { logger } from 'shared/logger';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';

import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: [
      'script[type="application/ld+json"]',
      'li[class^=couponListItem]',
    ],
    nonIndexPageSelectors: ['.slick-slider > .slick-list'],
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
