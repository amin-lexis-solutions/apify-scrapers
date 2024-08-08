import { logger } from 'shared/logger';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';

import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['div[data-name="offer_strip"]'],
    nonIndexPageSelectors: ['body[data-page-template="sitemap"]'],
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
