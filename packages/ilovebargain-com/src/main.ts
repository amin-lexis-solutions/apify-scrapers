// For more information, see https://crawlee.dev/
import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();
  const crawler = await prepareCheerioScraper(router, {});
  await crawler.run();
  await Actor.exit();
}

main();
