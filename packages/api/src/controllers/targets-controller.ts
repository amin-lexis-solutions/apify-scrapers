import {
  Authorized,
  JsonController,
  Post,
  QueryParam,
} from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { apify } from '../lib/apify';
import { getMerchantsForLocale } from '../lib/oberst-api';
import { prisma } from '../lib/prisma';
import { StandardResponse } from '../utils/validators';

@JsonController('/targets')
@Authorized()
@OpenAPI({ security: [{ token: [] }] })
export class TargetsController {
  @Post('/find')
  @OpenAPI({
    summary: 'Find target pages',
    description: 'For all available locales, find target pages to be updated',
  })
  @ResponseSchema(StandardResponse)
  async findTargetPages(
    @QueryParam('limit') limit: number
  ): Promise<StandardResponse> {
    const locales = await prisma.targetLocale.findMany({
      where: { isActive: true },
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
      locales.map(
        async ({ id, countryCode, languageCode, locale, searchTemplate }) => {
          const domains = await getMerchantsForLocale(locale);

          const queries = domains
            .map(({ domain }) => {
              return searchTemplate.replace('{{website}}', domain);
            })
            .slice(0, limit);

          await apify.actor('apify/google-search-scraper').start(
            {
              queries: queries.join('\n'),
              countryCode,
              languageCode,
              maxPagesPerQuery: 1,
              resultsPerPage: 10,
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
                  requestUrl: process.env.BASE_URL + '/webhooks/serp',
                  payloadTemplate: `{"localeId":"${id}","resource":{{resource}},"eventData":{{eventData}}}`,
                  headersTemplate: `{"authorization":"${process.env.API_SECRET}"}`,
                },
              ],
            }
          );

          return queries.length;
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
    summary: 'Run a scrape on all target pages',
    description: 'Run a scrape on all target pages for all active sources',
  })
  @ResponseSchema(StandardResponse)
  async runTargetPages(): Promise<StandardResponse> {
    const sources = await prisma.source.findMany({
      where: { isActive: true },
    });

    const counts = await Promise.all(
      sources.map(async (source) => {
        const pages = await prisma.targetPage.findMany({
          where: { domain: source.domain },
        });

        // group pages by locale
        const pagesByLocale = pages.reduce((acc, page) => {
          if (!acc[page.localeId]) {
            acc[page.localeId] = [];
          }
          acc[page.localeId].push(page);
          return acc;
        }, {} as Record<string, typeof pages>);

        await Promise.all(
          Object.entries(pagesByLocale).map(async ([localeId, pages]) => {
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
                    requestUrl: process.env.BASE_URL + '/webhooks/coupons',
                    payloadTemplate: `{"sourceId":"${source.id}","localeId":"${localeId}","resource":{{resource}},"eventData":{{eventData}}}`,
                    headersTemplate: `{"authorization":"${process.env.API_SECRET}"}`,
                  },
                ],
              }
            );
          })
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
