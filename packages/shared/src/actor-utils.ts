import * as Sentry from '@sentry/node';
import { Actor, RequestQueue } from 'apify';
import {
  CheerioCrawler,
  CheerioCrawlingContext,
  PuppeteerCrawlingContext,
  RouterHandler,
} from 'crawlee';
import { PuppeteerCrawler, log } from 'crawlee';

type Input = {
  startUrls: Array<{ url: string; metadata?: any }>;
  proxyConfiguration?: any;
};

type MainFunctionArgs = {
  // custom headers in a format of key-value pairs
  customHeaders?: Record<string, string>;
  domain?: string;
  maxRequestRetries?: number;
  indexPageSelectors?: string[];
  nonIndexPageSelectors?: string[];
};

const getStartUrlsArray = (startUrls) => {
  if (startUrls) {
    return startUrls.map((item: { url: string; metadata?: any }) => {
      return {
        url: item.url,
        metadata: item.metadata || {},
      };
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
  args?: MainFunctionArgs
) {
  const input = await Actor.getInput<Input>();
  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );
  const startUrls: any = input?.startUrls
    ? getStartUrlsArray(input.startUrls)
    : [];

  log.info(`Found ${startUrls.length} start URLs`);

  const requestQueue = await RequestQueue.open();

  const crawler = new CheerioCrawler({
    proxyConfiguration,
    requestHandler: router,
    requestQueue,
    maxRequestRetries: args?.maxRequestRetries || 3,
    failedRequestHandler: async ({ request, error }) => {
      // Log the error to Sentry
      Sentry.captureException(error, {
        extra: {
          url: request.url,
          userData: request.userData,
          numberOfRetries: request.retryCount,
        },
      });
    },
  });

  let customHeaders = CUSTOM_HEADERS;
  // If custom headers are provided, merge them with the default headers
  if (args?.customHeaders) {
    customHeaders = { ...customHeaders, ...args.customHeaders };
  }

  // Manually add each URL to the request queue

  const userData = {
    label: Label.listing,
    pageSelectors: {
      indexSelector: args?.indexPageSelectors,
      nonIndexSelector: args?.nonIndexPageSelectors,
    },
  };

  for (const { url, metadata } of startUrls) {
    await crawler?.requestQueue?.addRequest({
      url,
      userData: { ...userData, ...metadata },
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

  log.info(`Found ${startUrls.length} start URLs`);

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
    maxRequestRetries: args.maxRequestRetries || 3,
    failedRequestHandler: async ({ request, error }) => {
      // Log the error to Sentry
      Sentry.captureException(error, {
        extra: {
          url: request.url,
          numberOfRetries: request.retryCount,
        },
      });
    },
  });

  let customHeaders = CUSTOM_HEADERS;
  // If custom headers are provided, merge them with the default headers
  if (args.customHeaders) {
    customHeaders = { ...customHeaders, ...args.customHeaders };
  }

  // Manually add each URL to the request queue
  for (const { url, metadata } of startUrls) {
    await crawler?.requestQueue?.addRequest({
      url,
      userData: {
        label: Label.listing,
        pageSelectors: {
          indexSelector: args?.indexPageSelectors,
          nonIndexSelector: args?.nonIndexPageSelectors,
        },
        ...metadata,
      },
      headers: customHeaders,
    });
  }

  return crawler;
}

// Sleeps for the specified number of milliseconds
export function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
