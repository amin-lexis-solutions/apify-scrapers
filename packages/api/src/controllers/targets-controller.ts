import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { apify } from '../lib/apify';
import { getMerchantsForLocale } from '../lib/oberst-api';
import { prisma } from '../lib/prisma';
import { getWebhookUrl } from '../utils/utils';
import {
  FindTargetPagesBody,
  RunTargetPagesBody,
  StandardResponse,
} from '../utils/validators';
import moment from 'moment';
import log from '@apify/log';

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

    const scheduleTime = moment().toISOString();

    const counts = await Promise.all(
      locales.map(
        async ({ id, countryCode, languageCode, locale, searchTemplate }) => {
          let domains = await getMerchantsForLocale(locale);
          domains = domains.slice(0, limit);

          const chunkSize = 1_000;
          for (let i = 0; i < domains.length; i += chunkSize) {
            const domainsChunk = domains.slice(i, i + chunkSize);

            const queries = domainsChunk.map(({ domain }) => {
              return searchTemplate.replace('{{website}}', domain);
            });

            await apify.actor('apify/google-search-scraper').start(
              {
                queries: queries.join('\n'),
                countryCode,
                languageCode,
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
                    payloadTemplate: `{"localeId":"${id}","resource":{{resource}},"eventData":{{eventData}},"scheduledAt":"${scheduleTime}"}`,
                    headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
                  },
                ],
              }
            );
          }

          return domains.length;
        }
      )
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

    const maxApifyRunScheduledAtForEachDomain = await prisma.targetPage.groupBy(
      {
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
      }
    );

    const domainToMaxApifyRunScheduledAt = maxApifyRunScheduledAtForEachDomain.reduce(
      (acc, item) => {
        acc[item.domain] = item._max.apifyRunScheduledAt;
        return acc;
      },
      {} as Record<string, null | Date>
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
