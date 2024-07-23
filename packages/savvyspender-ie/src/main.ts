import 'shared/sentry-init';
import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['.E6jjcn .Zc7IjY'],
    nonIndexPageSelectors: ['.gallery-item-common-info'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
