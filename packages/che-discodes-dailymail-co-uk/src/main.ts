import { logger } from 'shared/logger';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

// trigger github action change
async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: [
      "div[data-testid='vouchers-ui-voucher-card']",
      "div[data-testid='header-widget']",
    ],
    nonIndexPageSelectors: [
      'div[data-testid="header-main-1"]',
      "div[data-testid='heroheader']",
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
