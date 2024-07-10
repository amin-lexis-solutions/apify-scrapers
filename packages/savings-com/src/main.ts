import 'shared/sentry-init';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['.list-deals'],
    nonIndexPageSelectors: ['#alpha-filter'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
