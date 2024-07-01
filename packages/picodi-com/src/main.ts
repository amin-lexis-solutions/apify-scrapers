import 'shared/sentry-init';
import { Actor } from 'apify';
import { prepareCheerioScraper } from 'shared/actor-utils';
import { router } from './routes';

async function main() {
  await Actor.init();

  const crawler = await prepareCheerioScraper(router, {
    customHeaders: { Origin: 'https://www.picodi.com' },
    indexPageSelectors: ['figure.hero-shop__logo', '.card-offers'],
    nonIndexPageSelectors: [
      '.blogs-description',
      '.filters__link',
      '.how-it-works ',
    ],
  });

  await crawler.run();
  await Actor.exit();
}

main();
