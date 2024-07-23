import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: [
      "div[data-testid='vouchers-ui-voucher-card-top-container']",
    ],
    nonIndexPageSelectors: ["div[data-testid='voucher-grid-card']"],
  });

  await crawler.run();
  await Actor.exit();
}

main();
