import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { Label, router } from './routes';

const startUrl = 'https://www.cuponation.com.sg/allshop';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    startUrl,
    label: Label.sitemap,
  });

  await crawler.run();
  await Actor.exit();
}

main();
