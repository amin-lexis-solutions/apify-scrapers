import { Actor, RequestQueue } from 'apify';
import {
  CheerioCrawler,
  CheerioCrawlingContext,
  PuppeteerCrawlingContext,
  RouterHandler,
} from 'crawlee';
import { PuppeteerCrawler } from 'crawlee';

type Input = {
  startUrls: Array<{ url: string }>;
  proxyConfiguration?: any;
};

type MainFunctionArgs = {
  // custom headers in a format of key-value pairs
  customHeaders?: Record<string, string>;
  domain?: string;
  countryCode?: string;
  extractDomainAndCountryCode?: boolean;
};

const getStartUrlsArray = (startUrls) => {
  if (startUrls) {
    return startUrls.map(({ url }) => {
      return url;
    });
  }
};

export const CUSTOM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/117.0',
};

export enum Label {
  'sitemap' = 'SitemapPage',
  'listing' = 'ProviderCouponsPage',
  'details' = 'VoucherDetailsPage',
  'getCode' = 'GetCodePage',
}

export async function prepareCheerioScraper(
  router: RouterHandler<CheerioCrawlingContext<Input>>,
  args: MainFunctionArgs
) {
  const input = await Actor.getInput<Input>();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );
  const startUrls: any = input?.startUrls
    ? getStartUrlsArray(input.startUrls)
    : [];

  console.log(`Found ${startUrls.length} start URLs`);

  const requestQueue = await RequestQueue.open();

  const crawler = new CheerioCrawler({
    proxyConfiguration,
    requestHandler: router,
    requestQueue,
  });

  let customHeaders = CUSTOM_HEADERS;
  // If custom headers are provided, merge them with the default headers
  if (args.customHeaders) {
    customHeaders = { ...customHeaders, ...args.customHeaders };
  }

  if (!crawler.requestQueue) {
    throw new Error('Request queue is not available');
  }

  // Manually add each URL to the request queue
  let userData;
  if (args.domain && args.countryCode) {
    userData = {
      label: Label.listing,
      domain: args.domain,
      countryCode: args.countryCode,
    };
  } else {
    userData = {
      label: Label.listing,
    };
  }
  let domain;
  let countryCode;
  for (const url of startUrls) {
    if (args.extractDomainAndCountryCode) {
      domain = new URL(url).hostname;
      // Get the country code as the last part of the domain
      countryCode = domain.split('.').slice(-1)[0]; // Equivalent to Python's [-1]
      userData = {
        label: Label.listing,
        domain,
        countryCode,
      };
    }
    await crawler.requestQueue.addRequest({
      url,
      userData: userData,
      headers: customHeaders,
    });
  }

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
  const startUrls: any = input?.startUrls
    ? getStartUrlsArray(input.startUrls)
    : [];

  console.log(`Found ${startUrls.length} start URLs`);

  const requestQueue = await RequestQueue.open();

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
    requestHandler: router as any,
    requestQueue,
  });

  let customHeaders = CUSTOM_HEADERS;
  // If custom headers are provided, merge them with the default headers
  if (args.customHeaders) {
    customHeaders = { ...customHeaders, ...args.customHeaders };
  }

  if (!crawler.requestQueue) {
    throw new Error('Request queue is not available');
  }

  // Manually add each URL to the request queue
  for (const url of startUrls) {
    await crawler.requestQueue.addRequest({
      url,
      userData: {
        label: Label.listing,
      },
      headers: customHeaders,
    });
  }

  return crawler;
}
