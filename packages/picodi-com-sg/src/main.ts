import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { Label, router } from './routes';

const startUrl = 'https://www.picodi.com/sg/sitemap.xml';

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
