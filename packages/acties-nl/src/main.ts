import { buildCheerioMainFunction } from 'shared/main-fn-builder';

import { Label, router } from './routes';

const startUrl = 'https://www.acties.nl/sitemap.xml';

const main = buildCheerioMainFunction({
  router,
  label: Label.sitemap,
  startUrl,
});

main();
