import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    customHeaders: { Origin: 'https://www.picodi.com' },
  });

  await crawler.run();
  await Actor.exit();
}

main();
