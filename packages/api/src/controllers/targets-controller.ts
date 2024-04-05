import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { apify } from '../lib/apify';
import { getMerchantsForLocale } from '../lib/oberst-api';
import { prisma } from '../lib/prisma';
import { getWebhookUrl } from '../utils/utils';
import {
  RunNLocalesBody,
  FindTargetPagesBody,
  RunTargetPagesBody,
  StandardResponse,
} from '../utils/validators';
import moment from 'moment';
import log from '@apify/log';
import { TargetLocale } from '@prisma/client';

const RESULTS_NEEDED_PER_LOCALE = 25;

@JsonController('/targets')
@Authorized()
@OpenAPI({ security: [{ bearerAuth: [] }] })
export class TargetsController {
  @Post('/find')
  @OpenAPI({
    summary: 'Find target pages',
    description: 'For a given locale (or all) find target pages to be updated',
  })
  @ResponseSchema(StandardResponse)
  async findTargetPages(
    @Body() body: FindTargetPagesBody
  ): Promise<StandardResponse> {
    const { limit, locale } = body;

    const locales = await prisma.targetLocale.findMany({
      where: { isActive: true, locale },
    });

    const unusableLocaleIndex = locales.findIndex(
      (locale) => !locale.searchTemplate.includes('{{website}}')
    );

    if (unusableLocaleIndex > -1) {
      return new StandardResponse(
        `Locale with ID ${locales[unusableLocaleIndex].id} does not contain '{{website}}' in the search template. Aborting.`,
        true
      );
    }

    const counts = await Promise.all(
      locales.map(async (locale) => {
        let domains = await getMerchantsForLocale(locale.locale);
        domains = domains.slice(0, limit);

        await findSerpForLocaleAndDomains(locale, domains);

        return domains.length;
      })
    );

    const result = locales.reduce((acc, locale, index) => {
      const lc = `${locale.languageCode}_${locale.countryCode}`;
      acc[lc] = counts[index];
      return acc;
    }, {} as Record<string, number>);

    return new StandardResponse('Target pages search started', false, result);
  }

  @Post('/find-n-locales')
  @OpenAPI({
    summary: 'Find target pages for a specified numner of locales',
    description:
      'Provide a number of locales to find target pages for. Outdated locales will be searched first',
  })
  @ResponseSchema(StandardResponse)
  async findNLocales(@Body() body: RunNLocalesBody): Promise<StandardResponse> {
    const { limitDomainsPerLocale, localesCount } = body;

    log.info(
      `Parsing request to run ${localesCount} locales` +
        (limitDomainsPerLocale
          ? ` with ${limitDomainsPerLocale} domains per locale`
          : '')
    );

    const localeIdsOldestFirst = await prisma.targetPage
      .groupBy({
        by: ['localeId'],
        _max: {
          apifyRunScheduledAt: true,
        },
        orderBy: {
          _max: {
            apifyRunScheduledAt: 'asc',
          },
        },
      })
      .then((locales) => locales.map((locale) => locale.localeId));

    log.info(
      'Locales with run history - oldest first: ' +
        JSON.stringify(localeIdsOldestFirst)
    );

    const localeIdsToRun = await prisma.targetLocale
      .findMany({
        where: {
          isActive: true,
          id: { notIn: localeIdsOldestFirst },
        },
        take: localesCount,
      })
      .then((locales: Array<TargetLocale>) =>
        locales.map((locale: TargetLocale) => locale.id)
      );

    log.info(
      'Locales without run history - to be run with priority: ' +
        JSON.stringify(localeIdsToRun)
    );

    if (localeIdsToRun.length < localesCount) {
      log.info(
        'Not enough locales without run history. Adding oldest locales.'
      );
      const localeIdsToAdd = localesCount - localeIdsToRun.length;
      for (let index = 0; index < localeIdsToAdd; index++) {
        localeIdsToRun.push(localeIdsOldestFirst[index]);
      }
    }

    log.info('Final list of locales to run' + JSON.stringify(localeIdsToRun));

    const locales = await prisma.targetLocale.findMany({
      where: {
        id: {
          in: localeIdsToRun,
        },
      },
    });

    const unusableLocaleIndex = locales.findIndex(
      (locale) => !locale.searchTemplate.includes('{{website}}')
    );

    if (unusableLocaleIndex > -1) {
      return new StandardResponse(
        `Locale with ID ${locales[unusableLocaleIndex].id} does not contain '{{website}}' in the search template. Aborting.`,
        true
      );
    }

    const counts = await Promise.all(
      locales.map(async (locale) => {
        let domains = await getMerchantsForLocale(locale.locale);
        if (limitDomainsPerLocale) {
          domains = domains.slice(0, limitDomainsPerLocale);
        }

        await findSerpForLocaleAndDomains(locale, domains);

        return domains.length;
      })
    );

    const result = locales.reduce((acc, locale, index) => {
      const lc = `${locale.languageCode}_${locale.countryCode}`;
      acc[lc] = counts[index];
      return acc;
    }, {} as Record<string, number>);

    return new StandardResponse('Target pages search started', false, result);
  }

  @Post('/run')
  @OpenAPI({
    summary: 'Run scrapes on target pages',
    description: 'Run scrapes on target pages for active sources',
  })
  @ResponseSchema(StandardResponse)
  async runTargetPages(
    @Body() body: RunTargetPagesBody
  ): Promise<StandardResponse> {
    const { maxConcurrency } = body;

    log.debug(
      `Will attempt to schedule ${maxConcurrency} sources (domains) for scraping.`
    );

    const sources = await prisma.source.findMany({
      where: {
        isActive: true,
        OR: [
          { lastRunAt: null },
          { lastRunAt: { lt: moment().startOf('day').toDate() } },
        ],
      },
      take: maxConcurrency,
    });

    log.info(
      `${sources.length} sources (domains) are to be scheduled for scraping`
    );

    await prisma.source.updateMany({
      where: { id: { in: sources.map((source) => source.id) } },
      data: { lastRunAt: new Date() },
    });

    const domainToMaxApifyRunScheduledAt = await domainToMaxApifyRunScheduledAtMapping();

    const counts = await Promise.all(
      sources.map(async (source) => {
        const apifyRunScheduledAt =
          domainToMaxApifyRunScheduledAt[source.domain];

        if (apifyRunScheduledAt === undefined) {
          log.info(
            `There are no fresh target pages (max 30 days old) for domain ${source.domain}. Skipping coupon scraping for actor ${source.apifyActorId}`
          );
          return 0;
        }

        const pages = await prisma.targetPage.findMany({
          where: {
            domain: source.domain,
            apifyRunScheduledAt,
          },
        });

        log.info(
          `Starting Apify actor ${source.apifyActorId} with ${pages.length} start URLs for source (domain) ${source.domain}.`
        );

        const localeId = pages[0]?.localeId;
        await apify.actor(source.apifyActorId).start(
          { startUrls: pages.map((page) => ({ url: page.url })) },
          {
            webhooks: [
              {
                eventTypes: [
                  'ACTOR.RUN.SUCCEEDED',
                  'ACTOR.RUN.FAILED',
                  'ACTOR.RUN.TIMED_OUT',
                  'ACTOR.RUN.ABORTED',
                ],
                requestUrl: getWebhookUrl('/webhooks/coupons'),
                payloadTemplate: `{"sourceId":"${source.id}","localeId":"${localeId}","resource":{{resource}},"eventData":{{eventData}}}`,
                headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
              },
            ],
          }
        );

        return pages.length;
      })
    );

    const result = sources.reduce((acc, actor, index) => {
      acc[actor.domain] = counts[index];
      return acc;
    }, {} as Record<string, number>);

    return new StandardResponse('Scraping job enqueued', false, result);
  }
}

async function domainToMaxApifyRunScheduledAtMapping() {
  const maxApifyRunScheduledAtForEachDomain = await prisma.targetPage.groupBy({
    by: ['domain'],
    where: {
      apifyRunScheduledAt: {
        gt: moment().subtract(30, 'day').toDate(),
        not: null,
      },
    },
    _max: {
      apifyRunScheduledAt: true,
    },
  });

  const domainToMaxApifyRunScheduledAt = maxApifyRunScheduledAtForEachDomain.reduce(
    (acc, item) => {
      acc[item.domain] = item._max.apifyRunScheduledAt;
      return acc;
    },
    {} as Record<string, null | Date>
  );

  return domainToMaxApifyRunScheduledAt;
}

async function findSerpForLocaleAndDomains(
  locale: TargetLocale,
  domains: Array<{ domain: string }>
) {
  log.info(
    `Locale ${locale.id} has ${domains.length} domains to search. Chunking into a few request with 1 000 domains each`
  );

  const scheduleTime = moment().toISOString();

  const chunkSize = 1_000;
  for (let i = 0; i < domains.length; i += chunkSize) {
    const domainsChunk = domains.slice(i, i + chunkSize);

    const queries = domainsChunk.map(({ domain }) => {
      return locale.searchTemplate.replace('{{website}}', domain);
    });

    await apify.actor('apify/google-search-scraper').start(
      {
        queries: queries.join('\n'),
        countryCode: locale.countryCode.toLowerCase(),
        languageCode: locale.languageCode,
        maxPagesPerQuery: 1,
        resultsPerPage: RESULTS_NEEDED_PER_LOCALE,
        saveHtml: false,
        saveHtmlToKeyValueStore: false,
        mobileResults: false,
      },
      {
        webhooks: [
          {
            eventTypes: [
              'ACTOR.RUN.SUCCEEDED',
              'ACTOR.RUN.FAILED',
              'ACTOR.RUN.TIMED_OUT',
              'ACTOR.RUN.ABORTED',
            ],
            requestUrl: getWebhookUrl('/webhooks/serp'),
            payloadTemplate: `{"localeId":"${locale.id}","resource":{{resource}},"eventData":{{eventData}},"scheduledAt":"${scheduleTime}"}`,
            headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
          },
        ],
      }
    );
  }
}
