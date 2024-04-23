import { Actor } from 'apify';
import 'shared/sentry-init';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();
  const crawler = await prepareCheerioScraper(router, {});

  await crawler.run();
  await Actor.exit();
}
main();
