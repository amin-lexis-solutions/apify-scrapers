import 'shared/sentry-init';
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
  await Actor.exit();
}

main();
