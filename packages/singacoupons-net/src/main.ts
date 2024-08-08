import { logger } from 'shared/logger';
import { Actor } from 'apify';
import { router } from './routes';
import { preparePuppeteerScraper } from 'shared/actor-utils';

async function main() {
  await Actor.init();
  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['.coupon-code', '.offer'],
    nonIndexPageSelectors: ['#home'],
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
