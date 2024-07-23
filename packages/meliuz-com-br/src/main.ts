import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.hero-sec__logo', '.cpn-list'],
    nonIndexPageSelectors: ['.partner-index-page__container'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
