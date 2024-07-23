import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from 'shared/next-routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ["div[data-testid='vouchers-ui-voucher-card']"],
    nonIndexPageSelectors: [
      'div[data-testid=heroheader]',
      "div[data-testid='alphabet-sections']",
    ],
  });

  await crawler.run();
  await Actor.exit();
}

main();
