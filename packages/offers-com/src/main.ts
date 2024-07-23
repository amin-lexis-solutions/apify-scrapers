import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';

import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ["body[data-page-template='merchant-page']"],
    nonIndexPageSelectors: [
      "body[data-page-template='merchant-index-page']",
      "body[data-page-template='category-index']",
    ],
  });

  await crawler.run();
  await Actor.exit();
}

main();
