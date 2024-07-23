import 'shared/sentry-init';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';

import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['div[data-name="offer_strip"]'],
    nonIndexPageSelectors: ['body[data-page-template="sitemap"]'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
