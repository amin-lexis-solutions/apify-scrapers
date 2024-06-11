import 'shared/sentry-init';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['div[data-testid=active-vouchers-widget]'],
    nonIndexPageSelectors: ['._1anmgjd1'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
