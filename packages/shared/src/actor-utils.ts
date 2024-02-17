import { Actor } from 'apify';
import {
  CheerioCrawler,
  CheerioCrawlingContext,
  PuppeteerCrawlingContext,
  RouterHandler,
} from 'crawlee';
import { PuppeteerCrawler } from 'crawlee';

type Input = {
  testLimit?: number;
  proxyConfiguration?: any;
};

type MainFunctionArgs = {
  startUrl: string;
  label: string;
};

export async function prepareCheerioScraper(
  router: RouterHandler<CheerioCrawlingContext<Input>>,
  args: MainFunctionArgs
) {
  const input = await Actor.getInput<Input>();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  let effectiveTestLimit = 0;
  if (typeof input?.testLimit === 'number' && input?.testLimit > 0) {
    effectiveTestLimit = input?.testLimit;
  }

  const crawler = new CheerioCrawler({
    proxyConfiguration,
    requestHandler: router,
  });

  await crawler.addRequests([
    {
      url: args.startUrl,
      label: args.label,
      userData: {
        testLimit: effectiveTestLimit,
      },
    },
  ]);

  return crawler;
}

export async function preparePuppeteerScraper(
  router: RouterHandler<PuppeteerCrawlingContext<Input>>,
  args: MainFunctionArgs
) {
  const input = await Actor.getInput<Input>();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  let effectiveTestLimit = 0;
  if (typeof input?.testLimit === 'number' && input?.testLimit > 0) {
    effectiveTestLimit = input?.testLimit;
  }

  const crawler = new PuppeteerCrawler({
    proxyConfiguration: proxyConfiguration as any,
    headless: true,
    useSessionPool: true,
    navigationTimeoutSecs: 60,
    launchContext: {
      launchOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    },
    requestHandler: router,
  });

  // Adding the initial request with a handlerLabel in userData
  await crawler.addRequests([
    {
      url: args.startUrl,
      label: args.label,
      userData: {
        testLimit: effectiveTestLimit,
      },
    },
  ]);

  return crawler;
}
