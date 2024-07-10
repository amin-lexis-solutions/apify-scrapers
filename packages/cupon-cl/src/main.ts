import 'shared/sentry-init';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['.shop-header-logo', '.coupons__list'],
    nonIndexPageSelectors: ['.featured-shops__order-0'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
