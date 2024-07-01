import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    indexPageSelectors: ['.BrandOffers', 'article.Offer'],
    nonIndexPageSelectors: ['a[href="/brands/a"]', 'a[href="/categories"]'],
  });

  await crawler.run();
  await Actor.exit();
}

main();
