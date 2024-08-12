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

const buildRequestData = async ({
  startUrls,
  pageSelectors,
  customHeaders,
}) => {
  if (!startUrls) {
    throw new Error(`StartUrls required`);
  }

  const queues: any[] = [];

  for (const item of startUrls) {
    queues.push({
      url: item.url,
      userData: {
        ...item.metadata,
        pageSelectors,
        customHeaders,
      },
      label: Label.listing,
    });
  }
  return queues;
};

export async function prepareCheerioScraper(
  router: RouterHandler<CheerioCrawlingContext<Input>>,
  args?: MainFunctionArgs
) {
  const input = await Actor.getInput<Input>();

  let customHeaders = CUSTOM_HEADERS;
  // If custom headers are provided, merge them with the default headers
  if (args?.customHeaders) {
    customHeaders = { ...customHeaders, ...args.customHeaders };
  }

  let pageSelectors = {};

  if (args?.indexPageSelectors && args.nonIndexPageSelectors) {
    pageSelectors = {
      indexSelector: args?.indexPageSelectors,
      nonIndexSelector: args?.nonIndexPageSelectors,
    };
  }

  const startUrls = input?.startUrls;

  const requestQueueData: any = startUrls
    ? await buildRequestData({
        startUrls,
        pageSelectors,
        customHeaders,
      })
    : [];

  log.info(`Found ${startUrls?.length} start URLs`);

  const requestQueue = await RequestQueue.open();

  for (const request of requestQueueData) {
    await requestQueue.addRequest({
      ...request,
    });
  }

  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

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

  return crawler;
}

export async function preparePuppeteerScraper(
  router: RouterHandler<PuppeteerCrawlingContext<Input>>,
  args: MainFunctionArgs
) {
  const input = await Actor.getInput<Input>();

  let customHeaders = CUSTOM_HEADERS;
  // If custom headers are provided, merge them with the default headers
  if (args?.customHeaders) {
    customHeaders = { ...customHeaders, ...args.customHeaders };
  }

  let pageSelectors = {};

  if (args?.indexPageSelectors && args.nonIndexPageSelectors) {
    pageSelectors = {
      indexSelector: args?.indexPageSelectors,
      nonIndexSelector: args?.nonIndexPageSelectors,
    };
  }

  const startUrls = input?.startUrls;

  const requestQueueData: any = startUrls
    ? await buildRequestData({
        startUrls,
        pageSelectors,
        customHeaders,
      })
    : [];

  log.info(`Found ${startUrls?.length} start URLs`);

  const requestQueue = await RequestQueue.open();

  for (const request of requestQueueData) {
    await requestQueue.addRequest({
      ...request,
    });
  }

  const proxyConfiguration = await Actor.createProxyConfiguration(
    input?.proxyConfiguration
  );

  const crawler = new PuppeteerCrawler({
    proxyConfiguration,
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

  return crawler;
}

// Sleeps for the specified number of milliseconds
export function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
