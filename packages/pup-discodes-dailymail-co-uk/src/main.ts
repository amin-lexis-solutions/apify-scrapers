import { Actor } from 'apify';
import { preparePuppeteerScraper } from 'shared/actor-utils';

import { Label, router } from './routes';

const startUrl = 'https://discountcode.dailymail.co.uk/sitemap.xml';

async function main() {
  await Actor.init();

  const crawler = await preparePuppeteerScraper(router, {
    startUrl,
    label: Label.sitemap,
  });

  await crawler.run();
  await Actor.exit();
}

main();
