import 'shared/sentry-init';
import { Actor } from 'apify';
import { router } from './routes';
import { preparePuppeteerScraper } from 'shared/actor-utils';

async function main() {
  await Actor.init();
  const crawler = await preparePuppeteerScraper(router as any, {
    indexPageSelectors: ['.coupon-code', '.offer'],
    nonIndexPageSelectors: ['#home'],
  });
  await crawler.run();
  await Actor.exit();
}
main();
