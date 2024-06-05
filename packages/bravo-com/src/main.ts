import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

(async () => {
  await Actor.init();
  const crawler = await prepareCheerioScraper(router);
  await crawler.run();
  await Actor.exit();
})();
