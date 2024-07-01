// For more information, see https://crawlee.dev/
import 'shared/sentry-init';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';

import { router } from './routes';

async function main() {
  await Actor.init();
  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['#active-coupons', '.sidebar-menu-box.store'],
    nonIndexPageSelectors: ['.categories', '.sitemap-stores'],
  });

  await crawler.run();
  await Actor.exit();
}
main();
