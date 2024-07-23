import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.gmc-list', '.gm-mri'],
    nonIndexPageSelectors: [
      "div[data-ctype='Category']",
      "div[data-ctype='Merchant']",
    ],
  });

  await crawler.run();
  await Actor.exit();
}

main();
