import { logger } from 'shared/logger';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['#info-title', '.li-box'],
    nonIndexPageSelectors: [
      '.category-list-page',
      '.merchant-list-page',
      '.tername-list-page',
    ],
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
