import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { Label, router } from './routes';

const startUrl = 'https://cdn-s3.sparwelt.de/sitemap/sitemap-provider.xml';

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
