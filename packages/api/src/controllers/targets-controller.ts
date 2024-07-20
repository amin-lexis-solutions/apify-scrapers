import * as Sentry from '@sentry/node';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import { apify } from '../lib/apify';
import { getMerchantsForLocale } from '../lib/oberst-api';
import { CostLimit } from '../middlewares/api-middleware';
import { prisma } from '../lib/prisma';
import { getWebhookUrl, availableActorRuns } from '../utils/utils';
import {
  RunNLocalesBody,
  FindTargetPagesBody,
  RunTargetPagesBody,
  TargetLocaleBody,
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
  @CostLimit()
  @ResponseSchema(StandardResponse)
  async findTargetPages(
    @Body() body: FindTargetPagesBody
  ): Promise<StandardResponse> {
    const { limit, locale } = body;

    const locales = await prisma.targetLocale.findMany({
      where: { isActive: true, locale },
    });

    const unusableLocaleIndex = locales.findIndex(
      (locale) => !locale.searchTemplate.includes('{{merchant_name}}')
    );

    if (unusableLocaleIndex > -1) {
      return new StandardResponse(
        `Locale ${locales[unusableLocaleIndex].locale} does not contain '{{merchant_name}}' in the search template. Aborting.`,
        true
      );
    }

    const counts = await Promise.all(
      locales.map(async (locale) => {
        let domains = await getMerchantsForLocale(locale.locale);
        domains = domains.slice(0, limit);

        await findSerpForLocaleAndMerchants(locale, domains);

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
  @CostLimit()
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
      (locale) => !locale.searchTemplate.includes('{{merchant_name}}')
    );

    if (unusableLocaleIndex > -1) {
      return new StandardResponse(
        `Locale ${locales[unusableLocaleIndex].locale} does not contain '{{merchant_name}}' in the search template. Aborting.`,
        true
      );
    }

    const counts = await Promise.all(
      locales.map(async (locale) => {
        let merchants = await getMerchantsForLocale(locale.locale);
        if (limitDomainsPerLocale) {
          merchants = merchants.slice(0, limitDomainsPerLocale);
        }

        await findSerpForLocaleAndMerchants(locale, merchants);

        await prisma.targetLocale.update({
          where: { id: locale.id },
          data: { lastSerpRunAt: new Date() },
        });

        return merchants.length;
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
  @CostLimit()
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
      take: maxConcurrency,
    });

    console.log(
      `Found ${sources.length} sources that have not been scraped today or have never been scraped.`
    );

    let actorsStarted = 0;

    const counts: any = [];
    for (const source of sources) {
      const availableRuns = await availableActorRuns();
      if (maxConcurrency <= actorsStarted || availableRuns <= actorsStarted) {
        console.log(
          `Reached the limit of ${actorsStarted} actors started. Skipping the rest of the sources.`
        );
        break;
      }

      const sourceDomains = source.domains.map((domain) => domain.domain);

      // Find the target pages for the source that have not been scraped in the  last 30 days
      const pages = await prisma.targetPage.findMany({
        where: {
          AND: [
            { domain: { in: sourceDomains } },
            { disabledAt: null },
            { merchant: { disabledAt: null } },
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
        include: {
          locale: true,
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

        console.log(
          `Init Apify actor ${source.apifyActorId} with ${pagesChunk.length} start URLs for source (domain) ${source.name}.`
        );

        const startUrls = pagesChunk.map((page) => ({
          url: page.url,
          metadata: {
            targetPageId: page.id,
            targetPageUrl: page.url,
            verifyLocale: page.verified_locale,
          },
        }));

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
                  payloadTemplate: `{"sourceId":"${source.id}","localeId":"${localeId}","resource":{{resource}},"eventData":{{eventData}} }`,
                  headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
                },
              ],
            }
          );

          actorsStarted++;

          await prisma.targetPage.updateMany({
            where: {
              id: { in: pagesChunk.map((page) => page.id) },
            },
            data: { lastApifyRunAt: new Date() },
          });
        } catch (e) {
          console.error(
            `Failed to start actor ${source.apifyActorId} with ${startUrls.length} start URLs for source ${source.name} and locale ${localeId}`
          );
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

  @Post('/find-for-urls-and-locale')
  @OpenAPI({
    summary: 'Retrieving Locale-Specific Target Pages from URLs',
    description:
      'Find target pages associated with specific URLs for a given locale',
  })
  @ResponseSchema(StandardResponse)
  async findTargetLocales(
    @Body() body: TargetLocaleBody
  ): Promise<StandardResponse> {
    const {
      urls,
      locale,
      localeKeywords = false,
      resultsPerPage = 1,
      maxPagesPerQuery = 1,
    } = body;

    const targetLocale = await prisma.targetLocale.findFirst({
      where: {
        locale: locale,
      },
    });

    if (!targetLocale) {
      return new StandardResponse(`Locale ${locale} not found`, true);
    }

    const searchTemplate = localeKeywords
      ? `"${targetLocale.searchTemplate
          .replace('{{merchant_name}}', '')
          .trim()}"`
      : '';

    const brands = await getMerchantsForLocale(targetLocale.locale);
    const queries = brands.flatMap((brand) =>
      urls.map((url) => `site:${url} ${searchTemplate} "${brand.name}"`)
    );

    if (queries.length === 0) {
      return new StandardResponse(
        `No queries generated for locale ${locale} and ${urls.length} URLs / brands . Aborting.`,
        true
      );
    }

    const chunkSize = 1_000;
    for (let i = 0; i < queries.length; i += chunkSize) {
      const queriesChunk = queries.slice(i, i + chunkSize);

      await apify
        .actor('apify/google-search-scraper')
        .start(
          {
            queries: queriesChunk.join('\n'),
            countryCode: targetLocale.countryCode.toLowerCase(),
            languageCode: targetLocale.languageCode,
            maxPagesPerQuery: maxPagesPerQuery,
            resultsPerPage: resultsPerPage,
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            includeUnfilteredResults: false,
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
                payloadTemplate: `{"localeId":"${targetLocale.id}","resource":{{resource}},"eventData":{{eventData}},"removeDuplicates":false}`,
                headersTemplate: `{"Authorization":"Bearer ${process.env.API_SECRET}"}`,
              },
            ],
          }
        )
        .then(() => {
          console.log(
            `Started search for ${targetLocale.locale} with ${queriesChunk.length} queries`
          );
        })
        .catch((e) => {
          console.error(e);
          return new StandardResponse('Error starting search', true, {
            error: e,
          });
        });
    }
    return new StandardResponse(
      `Target pages search started for ${locale} : ${queries.length} queries`,
      false
    );
  }
}

async function findSerpForLocaleAndMerchants(
  locale: TargetLocale,
  merchants: Array<{ domain: string; name: string }>
) {
  console.log(
    `Locale ${locale.locale} has ${merchants.length} merchants to search for`
  );

  const chunkSize = 1_000;
  for (let i = 0; i < merchants.length; i += chunkSize) {
    const merchantsChunk = merchants.slice(i, i + chunkSize);

    const queries = merchantsChunk.map(({ name }) => {
      return locale.searchTemplate.replace('{{merchant_name}}', name);
    });

    await apify
      .actor('apify/google-search-scraper')
      .start(
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
      )
      .then(() => {
        console.log(
          `Started search for ${locale.locale} with ${merchantsChunk.length} domains`
        );
      });
  }
}
