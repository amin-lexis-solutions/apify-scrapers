import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: [
      "div[data-testid='VouchersList']",
      "div[data-testid='VouchersListItem']",
    ],
    nonIndexPageSelectors: [
      'section[data-testid="CategoriesOverviewGrid"]',
      '[data-testid="StoresSection"]',
    ],
  });

  await crawler.run();
  await Actor.exit();
}

main();
