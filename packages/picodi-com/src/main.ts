import { logger } from 'shared/logger';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    customHeaders: { Origin: 'https://www.picodi.com' },
    indexPageSelectors: ['figure.hero-shop__logo', '.card-offers'],
    nonIndexPageSelectors: [
      '.blogs-description',
      '.filters__link',
      '.how-it-works ',
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
