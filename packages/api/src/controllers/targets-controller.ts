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
import { TargetLocale } from '@prisma/client';

type LocaleLastRun = {
  apifyRunScheduledAt: string;
  localeId: string;
};

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
            lt: moment().subtract(2, 'weeks').toDate(),
          },
        },
        orderBy: { lastSerpRunAt: 'asc' },
        take: localesCount - localeIdWithoutRunHistory.length,
      })
      .then((locales) => locales.map((locale) => locale.id));

    const localeIdsToRun = localeIdWithoutRunHistory.concat(
      localeIdsOldestFirst
    );

    console.log('Final list of locales to run' + JSON.stringify(localeIdsToRun));

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

    const sources = await prisma.source.findMany({
      where: {
        isActive: true,
        OR: [
          { lastRunAt: null },
          { lastRunAt: { lt: moment().startOf('day').toDate() } },
        ],
      },
      include: {
        domains: true,
      },
      take: maxConcurrency,
    });

    console.log(
      `Found ${sources.length} potential sources (domains) to be scheduled for scraping`
    );

    let actorsStarted = 0;

    const counts = await Promise.all(
      sources.map(async (source) => {
        if (maxConcurrency <= actorsStarted) {
          console.log(
            `Already scheduled the maximum number of actors. Skipping source ${source.id}.`
          );
          return 0;
        }

        const twoWeeksAgo = moment().subtract(30, 'day').toDate();

        // Find the latest run for each locale
        const uniqueLocalesLastRuns = await prisma.$queryRaw<LocaleLastRun[]>`
          SELECT MAX(t."apifyRunScheduledAt") as "apifyRunScheduledAt", t."localeId" FROM (
            SELECT "TargetPage"."apifyRunScheduledAt", "TargetPage"."localeId"
            FROM "TargetPage"
            WHERE "TargetPage"."apifyRunScheduledAt" IS NOT NULL
              AND "TargetPage"."apifyRunScheduledAt" > ${twoWeeksAgo}
            GROUP BY "TargetPage"."apifyRunScheduledAt", "TargetPage"."localeId"
            ORDER BY "apifyRunScheduledAt" DESC
          ) AS t
          GROUP BY t."localeId";
        `;

        // Find all target pages for the source domains that have not been scraped in the last two weeks
        const pages = await prisma.targetPage.findMany({
          where: {
            domain: {
              in: source.domains.map((domain) => domain.domain),
            },
            OR: uniqueLocalesLastRuns,
          },
        });


        if (pages.length === 0) {
          console.log(
            `There are no fresh target pages for domain ${source.domain}. Skipping coupon scraping for actor ${source.apifyActorId}`
          );
          return 0;
        }

        console.log(
          `Starting Apify actor ${source.apifyActorId} with ${pages.length} start URLs for source (domain) ${source.domain}. Will be chunking the start URLs in groups of 1000.`
        );

        await prisma.source.update({
          where: { id: source.id },
          data: { lastRunAt: new Date() },
        });

        const localeId = pages[0]?.localeId;

        const chunkSize = 1_000;
        for (let i = 0; i < pages.length; i += chunkSize) {
          const pagesChunk = pages.slice(i, i + chunkSize);

          actorsStarted++;

          console.log(
            `Init Apify actor ${source.apifyActorId} with ${pagesChunk.length} start URLs for source (domain) ${source.domain}.`
          );

          await apify.actor(source.apifyActorId).start(
            { startUrls: pagesChunk.map((page) => ({ url: page.url })) },
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
        }

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

async function findSerpForLocaleAndDomains(
  locale: TargetLocale,
  domains: Array<{ domain: string }>
) {
  console.log(
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
