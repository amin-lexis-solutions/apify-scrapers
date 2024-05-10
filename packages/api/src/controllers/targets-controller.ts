import * as Sentry from '@sentry/node';
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
import dayjs from 'dayjs';
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

        await prisma.targetLocale.update({
          where: { id: locale.id },
          data: { lastSerpRunAt: new Date() },
        });

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

    console.log(
      `Parsing request to run ${localesCount} locales` +
        (limitDomainsPerLocale
          ? ` with ${limitDomainsPerLocale} domains per locale`
          : '')
    );

    const localeIdWithoutRunHistory = await prisma.targetLocale
      .findMany({
        where: {
          isActive: true,
          lastSerpRunAt: null,
        },
        take: localesCount,
      })
      .then((locales) => locales.map((locale) => locale.id));

    const localeIdsOldestFirst = await prisma.targetLocale
      .findMany({
        where: {
          isActive: true,
          lastSerpRunAt: {
            not: null,
            lt: dayjs().subtract(2, 'weeks').toDate(),
          },
        },
        orderBy: { lastSerpRunAt: 'asc' },
        take: localesCount - localeIdWithoutRunHistory.length,
      })
      .then((locales) => locales.map((locale) => locale.id));

    const localeIdsToRun = localeIdWithoutRunHistory.concat(
      localeIdsOldestFirst
    );

    console.log(
      'Final list of locales to run' + JSON.stringify(localeIdsToRun)
    );

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

        await prisma.targetLocale.update({
          where: { id: locale.id },
          data: { lastSerpRunAt: new Date() },
        });

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
    console.log(
      `Will attempt to schedule ${maxConcurrency} sources (maps to actor) for scraping.`
    );

    // Find sources that have not been scraped today or have never been scraped
    const sources = await prisma.source.findMany({
      where: {
        isActive: true,
        OR: [
          { lastRunAt: null },
          { lastRunAt: { lt: dayjs().startOf('day').toDate() } },
        ],
      },
      include: {
        domains: true,
      },
      // take: maxConcurrency,
    });

    console.log(
      `Found ${sources.length} potential sources (domains) to be scheduled for scraping`
    );

    let actorsStarted = 0;

    const counts: any = [];
    for (const source of sources) {
      if (maxConcurrency <= actorsStarted) {
        console.log(
          `Already scheduled the maximum number of actors. Skipping source ${source.id}.`
        );
        break;
      }

      const sourceDomains = source.domains.map((domain) => domain.domain);

      // Find the target pages for the source that have not been scraped in the  last 30 days
      const pages = await prisma.targetPage.findMany({
        where: {
          AND: [
            { domain: { in: sourceDomains } },
            {
              OR: [
                { lastApifyRunAt: null },
                {
                  lastApifyRunAt: { lt: dayjs().subtract(30, 'days').toDate() },
                },
              ],
            },
          ],
        },
      });

      if (pages.length === 0) {
        console.log(
          `There are no fresh target pages for domain ${source.name}. Skipping coupon scraping for actor ${source.apifyActorId}`
        );
        continue;
      }

      console.log(
        `Starting Apify actor ${source.apifyActorId} with ${pages.length} start URLs for source (domain) ${source.name}. Will be chunking the start URLs in groups of 1000.`
      );

      const localeId = pages[0]?.localeId;

      const chunkSize = 1_000;
      for (let i = 0; i < pages.length; i += chunkSize) {
        const pagesChunk = pages.slice(i, i + chunkSize);

        // could potentually start more actors than maxConcurrency; should be fine since the maxConcurrency actually keep a buffer
        actorsStarted++;

        console.log(
          `Init Apify actor ${source.apifyActorId} with ${pagesChunk.length} start URLs for source (domain) ${source.name}.`
        );

        const startUrls = pagesChunk.map((page) => ({ url: page.url }));
        const targetIds = pagesChunk.map((page) => page.id);

        try {
          await apify.actor(source.apifyActorId).start(
            { startUrls: startUrls },
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
                  payloadTemplate: `{"sourceId":"${source.id}","localeId":"${localeId}","resource":{{resource}},"eventData":{{eventData}},"targetIds": "${targetIds}" }`,
                  headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
                },
              ],
            }
          );
        } catch (e) {
          // add data to Sentry capture exception and message
          Sentry.captureException(e, {
            extra: {
              sourceId: source.id,
              localeId: localeId,
              targetIds: targetIds,
              startUrls: startUrls,
            },
          });
          Sentry.captureMessage(
            `Failed to start actor ${source.apifyActorId} with ${startUrls.length} start URLs for source ${source.name} and locale ${localeId}`
          );
          continue;
        }
        await prisma.targetPage.updateMany({
          where: {
            id: { in: pagesChunk.map((page) => page.id) },
          },
          data: { lastApifyRunAt: new Date() },
        });
      }

      await prisma.source.update({
        where: { id: source.id },
        data: { lastRunAt: new Date() },
      });

      counts.push(pages.length);
    }

    // Return the number of pages started for each source (actor)
    const result = sources.reduce((acc, source, index) => {
      if (counts[index] > 0) {
        acc[source.name] = counts[index];
      }
      return acc;
    }, {} as Record<string, number>);

    return new StandardResponse('Scraping job enqueued', false, result);
  }
}

async function findSerpForLocaleAndDomains(
  locale: TargetLocale,
  domains: Array<{ domain: string }>
) {
  console.log(
    `Locale ${locale.id} has ${domains.length} domains to search. Chunking into a few request with 1 000 domains each`
  );

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
            payloadTemplate: `{"localeId":"${locale.id}","resource":{{resource}},"eventData":{{eventData}}}`,
            headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
          },
        ],
      }
    );
  }
}
