import * as Sentry from '@sentry/node';
import { Coupon, Prisma, $Enums } from '@prisma/client';
import fetch from 'node-fetch';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import dayjs from 'dayjs';
import { ApifyGoogleSearchResult } from '../lib/apify';
import { prisma } from '../lib/prisma';
import {
  validDateOrNull,
  getToleranceMultiplier,
  removeDuplicateCoupons,
  getGoogleActorPriceInUsdMicroCents,
  getLocaleFromUrl,
  isValidLocale,
  isValidCouponCode,
  findMerchantBySearchTerm,
} from '../utils/utils';

import {
  SerpWebhookRequestBody,
  StandardResponse,
  TestWebhookRequestBody,
  WebhookRequestBody,
} from '../utils/validators';
import { generateItemId } from 'shared/helpers';

const updatableFields: (keyof Coupon)[] = [
  'domain',
  'title',
  'description',
  'termsAndConditions',
  'expiryDateAt',
  'code',
  'startDateAt',
  'isShown',
  'isExpired',
  'isExclusive',
];

@JsonController('/webhooks')
@Authorized()
export class WebhooksController {
  @Post('/coupons')
  @OpenAPI({
    summary: 'Receive webhook data for coupons',
    description:
      'Process and store the data received from the webhook. Do not call this endpoint directly, it is meant to be called by Apify.',
  })
  @ResponseSchema(StandardResponse)
  async receiveData(
    @Body() webhookData: WebhookRequestBody
  ): Promise<StandardResponse> {
    const { defaultDatasetId, status, usageTotalUsd } = webhookData.resource;
    const { actorRunId, actorId: apifyActorId } = webhookData.eventData;
    const startedAt = new Date();
    const run = await prisma.processedRun.create({
      data: {
        apifyActorId,
        actorRunId,
        status,
        startedAt,
        payload: webhookData as any,
      },
    });

    // Process data asynchronously to not block the response
    setTimeout(async () => {
      const scrapedData = await this.fetchScrapedData(defaultDatasetId, run.id);

      console.log(
        `Processing ${scrapedData?.length} coupons Actor ${actorRunId}`
      );

      await prisma.processedRun.update({
        where: { id: run.id },
        data: {
          resultCount: scrapedData?.length || 0,
          costInUsdMicroCents: Number(usageTotalUsd) * 1000000,
        },
      });

      // if scrapedData  is  not array, log error and return
      if (!Array.isArray(scrapedData) || scrapedData.length === 0) {
        Sentry.captureException(
          `No data was scraped for run ${run.id} from source ${apifyActorId}`
        );
        return;
      }
      // Handle non-index pages
      const coupons = await this.handleNonIndexPages(scrapedData, actorRunId);
      // Process coupons
      const { couponStats, errors } = await this.processCoupons(
        coupons,
        apifyActorId
      );

      // Update coupon stats
      await this.updateCouponStats(scrapedData, apifyActorId);

      // Update processed run
      await prisma.processedRun.update({
        where: { id: run.id },
        data: {
          createdCount: couponStats.createdCount || 0,
          updatedCount: couponStats.updatedCount || 0,
          archivedCount: couponStats.archivedCount || 0,
          unarchivedCount: couponStats.unarchivedCount || 0,
          resultCount: scrapedData.length,
          errorCount: errors.length,
          processingErrors: errors,
          endedAt: new Date(),
        },
      });

      try {
        const requests = await getActorRunRequests(actorRunId);
        if (requests && requests.length > 0) {
          const sourceUrls: any = requests.map((r: any) => r.loadedUrl);
          const coupons = await prisma.coupon.updateMany({
            where: {
              sourceUrl: { in: sourceUrls },
              lastSeenAt: {
                lt: startedAt,
              },
              isShown: true,
            },
            data: {
              isShown: false,
              archivedAt: new Date(),
              archivedReason: $Enums.ArchiveReason.removed,
            },
          });
          console.log(
            `Archived ${coupons.count} coupons for actor run ${actorRunId}`
          );
        }
      } catch (error) {
        Sentry.captureException(
          `Error isShown: false / coupons for actor run ${actorRunId}`,
          { extra: { error } }
        );
      }

      // eslint-disable-next-line no-console
      console.log('Processed run', run.id);
      // eslint-disable-next-line no-console
      console.table({
        actorRunId,
        ...couponStats,
        errors: errors.length,
        apify_dataset: scrapedData.length,
      });

      // Send Sentry notification
      this.sendSentryNotification(
        scrapedData.length,
        couponStats,
        errors,
        run.id,
        apifyActorId
      );
    }, 0);

    return new StandardResponse('Data processed successfully', false);
  }

  // Fetch data from Apify
  private async fetchScrapedData(datasetId: string, runId: string) {
    try {
      const response = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${process.env.APIFY_ORG_TOKEN_OBERST}`
      );
      const data = await response.json();

      // Remove duplicate coupons
      return removeDuplicateCoupons(data);
    } catch (error) {
      Sentry.captureMessage(
        `Error fetching data from Apify for run ${runId}: ${error}`
      );
      return null;
    }
  }

  // Process and store the coupons
  private async processCoupons(scrapedData: any, apifyActorId: string) {
    const now = new Date();
    const couponStats = {
      createdCount: 0,
      updatedCount: 0,
      unarchivedCount: 0,
      archivedCount: 0,
    };
    const errors: Record<string, any>[] = [];
    const sourceUrlsSet = new Set<string>();
    const couponsIds: string[] = [];

    for (const item of scrapedData) {
      const id = generateItemId(
        item?.merchantName,
        item?.idInSite,
        item?.sourceUrl
      );
      couponsIds.push(id);
      sourceUrlsSet.add(item.sourceUrl);

      const existingRecord = await prisma.coupon.findUnique({ where: { id } });
      const { updateData, archivedAt, archivedReason } = this.prepareUpdateData(
        item,
        existingRecord,
        now,
        apifyActorId
      );

      const createData = this.prepareCreateData(
        item,
        apifyActorId,
        id,
        now,
        archivedAt,
        archivedReason
      );

      try {
        await prisma.coupon.upsert({
          where: { id },
          update: updateData,
          create: createData,
        });

        // Count the number of created, updated, archived and unarchived records for the stats
        this.updateCouponStatsCount(couponStats, existingRecord, updateData);
      } catch (error) {
        errors.push({
          index: scrapedData.indexOf(item),
          error: error,
          updateData: updateData,
          createData: createData,
        });
      }
    }

    // Update lastApifyRunAt for target pages
    if (sourceUrlsSet.size > 0) {
      const sourceUrls = Array.from(sourceUrlsSet);
      await prisma.targetPage.updateMany({
        where: { url: { in: sourceUrls } },
        data: { lastApifyRunAt: dayjs().toDate() },
      });

      // Archive coupons that were not updated in the current run
      couponStats.archivedCount = await this.archiveNonExistingCouponsInPage(
        couponsIds,
        sourceUrls
      );
    }

    return { couponStats, errors };
  }

  // Prepare the coupons for updates and creation
  private prepareUpdateData(
    item: any,
    existingRecord: Coupon | null,
    now: Date,
    apifyActorId: string
  ) {
    const updateData: Prisma.CouponUpdateInput = {
      lastSeenAt: now,
      lastCrawledAt: now,
    };

    let archivedAt = null;
    let archivedReason:
      | Prisma.NullableEnumArchiveReasonFieldUpdateOperationsInput
      | $Enums.ArchiveReason
      | null = null;

    for (const [key, value] of Object.entries(item)) {
      if (updatableFields.includes(key as keyof Coupon)) {
        if (key === 'isExpired' && typeof value === 'boolean') {
          if (value) {
            archivedAt = now;
            archivedReason = 'expired';
            updateData.isShown = false;
          } else if (existingRecord?.isExpired) {
            archivedAt = null;
            archivedReason = 'unexpired';
            updateData.isShown = true;
          }
        }

        if (
          key === 'title' &&
          value &&
          existingRecord?.title?.trim() !== value &&
          existingRecord?.isExpired
        ) {
          archivedAt = null;
          archivedReason = 'unexpired';
          updateData.isShown = true;
        }

        const locale = item.metadata.verifyLocale
          ? item.metadata.verifyLocale
          : getLocaleFromUrl(item.sourceUrl);

        const merchantId = item.metadata.merchantId || null;

        if (!merchantId) {
          Sentry.captureException(
            `merchantId not found for coupon ${item.id}. Source URL: ${item.sourceUrl}`,
            { extra: { item } }
          );
        }

        if (merchantId && !existingRecord?.merchantId) {
          updateData.merchant_relation = {
            connect: { id: merchantId },
          };
        }

        if (locale) {
          updateData.locale_relation = {
            connect: { locale },
          };
        }
        updateData.source_relation = {
          connect: { apifyActorId },
        };
        updateData.archivedAt = archivedAt;
        updateData.archivedReason = archivedReason;
        (updateData as any)[key] =
          key === 'expiryDateAt' || key === 'startDateAt'
            ? validDateOrNull(value as string)
            : value || null;
      }
    }
    return {
      updateData,
      archivedAt,
      archivedReason,
    };
  }

  // Prepare the data for creating a new coupon
  private prepareCreateData(
    item: any,
    apifyActorId: string,
    id: string,
    now: Date,
    archivedAt: Date | null,
    archivedReason: $Enums.ArchiveReason | null
  ) {
    let sourceUrl = item.sourceUrl || null;

    if (
      sourceUrl !== item.metadata.targetPageUrl &&
      item.metadata.targetPageUrl !== undefined
    ) {
      sourceUrl = item.metadata.targetPageUrl;
      Sentry.captureMessage(
        `sourceUrl mismatch for coupon ${id}. Expected: ${item.metadata.targetPageUrl}, got: ${item.sourceUrl}`
      );
    }

    const merchantId = item.metadata.merchantId || null;

    if (!merchantId) {
      Sentry.captureException(
        `merchantId not found for coupon ${id}. Source URL: ${sourceUrl}`,
        { extra: { item } }
      );
    }

    const locale = item.metadata.verifyLocale
      ? item.metadata.verifyLocale
      : getLocaleFromUrl(item.sourceUrl);

    if (!locale) {
      Sentry.captureException(
        `Locale not found for coupon ${id}. Source URL: ${sourceUrl}`,
        { extra: { item } }
      );
    }

    return {
      id,
      apifyActorId,
      locale,
      merchantId,
      idInSite: item.idInSite,
      domain: item.domain || null,
      merchantName: item.merchantName,
      title: item.title || null,
      description: item.description || null,
      termsAndConditions: item.termsAndConditions || null,
      expiryDateAt: validDateOrNull(item.expiryDateAt) || null,
      code: item.code || null,
      startDateAt: validDateOrNull(item.startDateAt) || null,
      sourceUrl: sourceUrl,
      isShown: true,
      isExpired: item.isExpired || null,
      isExclusive: item.isExclusive || null,
      firstSeenAt: now,
      lastSeenAt: now,
      lastCrawledAt: now,
      archivedAt,
      archivedReason,
      shouldBeFake: item.code ? !isValidCouponCode(item.code) : null,
    };
  }

  // Update the coupon stats count
  private updateCouponStatsCount(
    couponStats: any,
    existingRecord: Coupon | null,
    updateData: Prisma.CouponUpdateInput
  ) {
    if (!existingRecord) {
      couponStats.createdCount++;
    } else if (!existingRecord.archivedAt && updateData.archivedAt) {
      couponStats.archivedCount++;
    } else if (existingRecord.archivedAt && !updateData.archivedAt) {
      couponStats.unarchivedCount++;
    } else {
      couponStats.updatedCount++;
    }
  }

  // Update the coupon stats
  private async updateCouponStats(coupons: any, apifyActorId: string) {
    if (!coupons) return;

    const couponStats: Record<string, any> = {};

    const ANOMALY_DETECTION_DAYS =
      Number(process.env.ANOMALY_DETECTION_DAYS) || 14;

    coupons.forEach((coupon: any) => {
      const sourceUrl = coupon.sourceUrl;
      if (!couponStats[sourceUrl]) {
        couponStats[sourceUrl] = {
          count: 0,
          historical: [],
          surgeThreshold: 0,
          plungeThreshold: 0,
          anomalyType: null,
        };
      }
      couponStats[sourceUrl].count++;
    });

    for (const sourceUrl of Object.keys(couponStats)) {
      const couponCount = couponStats[sourceUrl].count;

      const historicalData = await prisma.couponStats.findMany({
        where: {
          sourceUrl,
          createdAt: {
            gte: dayjs().subtract(ANOMALY_DETECTION_DAYS, 'day').toDate(),
          },
        },
      });

      const counts = historicalData.map(
        (data) => data.couponsCount
      ) as number[];

      const averageCount = counts.length
        ? counts.reduce((a, b) => a + b) / counts.length
        : couponCount;

      const toleranceMultiplier = getToleranceMultiplier(averageCount);
      const surgeThreshold = averageCount * (1 + toleranceMultiplier);
      const plungeThreshold = Math.max(
        1,
        averageCount * (1 - toleranceMultiplier)
      );

      let anomalyType: 'Surge' | 'Plunge' | null = null;
      if (couponCount > surgeThreshold) {
        anomalyType = 'Surge';
      } else if (couponCount < plungeThreshold) {
        anomalyType = 'Plunge';
      }

      couponStats[sourceUrl] = {
        count: couponCount,
        historical: counts,
        surgeThreshold,
        plungeThreshold,
        anomalyType,
      };
    }

    const statsData = Object.keys(couponStats).map((sourceUrl) => ({
      sourceUrl,
      couponsCount: couponStats[sourceUrl].count,
      surgeThreshold: couponStats[sourceUrl].surgeThreshold,
      plungeThreshold: couponStats[sourceUrl].plungeThreshold,
    }));

    try {
      await prisma.couponStats.createMany({ data: statsData });
    } catch (error) {
      Sentry.captureException(
        new Error(`Error saving coupon stats for source ${apifyActorId}`),
        {
          extra: { error, statsData },
        }
      );
    }

    const anomaliesData = Object.keys(couponStats)
      .filter((sourceUrl) => couponStats[sourceUrl].anomalyType)
      .map((sourceUrl) => ({
        sourceUrl,
        anomalyType: couponStats[sourceUrl].anomalyType,
        couponCount: couponStats[sourceUrl].count,
      }));

    if (anomaliesData.length > 0) {
      Sentry.captureException(
        new Error(`Anomalies detected for source ${apifyActorId}`),
        {
          extra: { anomaliesData },
        }
      );
    }
  }

  private async handleNonIndexPages(scrapedData: any, actorRunId: string) {
    const nonIndexPages = scrapedData.filter(
      (item: any) => item.__isNotIndexPage
    );
    if (nonIndexPages.length > 0) {
      const targetPagesArray = nonIndexPages.map((item: any) => item?.__url);

      await prisma.targetPage.updateMany({
        where: {
          url: { in: targetPagesArray },
          markedAsNonIndexAt: {
            not: null,
            lt: dayjs().subtract(1, 'day').toDate(),
          },
          disabledAt: null,
        },
        data: { disabledAt: dayjs().toDate() },
      });

      await prisma.targetPage.updateMany({
        where: {
          url: { in: targetPagesArray },
          markedAsNonIndexAt: null,
        },
        data: {
          markedAsNonIndexAt: dayjs().toDate(),
          lastApifyRunAt: dayjs().toDate(),
        },
      });

      Sentry.captureException(
        new Error(
          ` ${nonIndexPages.length}  Non-index pages detected on this actor run ${actorRunId}` +
            `from ${scrapedData.length} results`
        ),
        {
          extra: { nonIndexPages },
        }
      );
      return scrapedData.filter((item: any) => !item.__isNotIndexPage);
    }

    return scrapedData;
  }

  private sendSentryNotification(
    resultCount: number,
    couponStats: any,
    errors: any[],
    runId: string,
    apifyActorId: string
  ) {
    if (resultCount === 0) {
      Sentry.captureMessage(
        `No data was processed for run ${runId} from source ${apifyActorId}`
      );
    }
    if (errors.length > 0) {
      Sentry.captureException(
        `Errors occurred during processing run ${runId} from source ${apifyActorId}`,
        {
          extra: { errors },
        }
      );
    }
    if (resultCount !== couponStats.createdCount + couponStats.updatedCount) {
      Sentry.captureMessage(
        `Not all data was processed for run ${runId} from source ${apifyActorId}`
      );
    }
  }

  // Define an asynchronous function to check and handle non-existing coupons in a page
  private async archiveNonExistingCouponsInPage(
    couponIds: string[],
    sourceUrls: string[]
  ) {
    try {
      // Update the inaccessible coupons in the database, marking them as removed, with the current date, and expired
      const result = await prisma.coupon.updateMany({
        where: {
          sourceUrl: { in: sourceUrls },
          id: {
            notIn: couponIds,
          },
          archivedReason: null,
          archivedAt: null,
        },
        data: {
          archivedReason: $Enums.ArchiveReason.removed,
          archivedAt: new Date(),
          isExpired: true,
          isShown: false,
        },
      });

      return result.count;
    } catch (err) {
      Sentry.captureException(`Error archiving non-existing coupons in page`, {
        extra: { couponIds, sourceUrls, err },
      });
    }
    return 0;
  }

  @Post('/serp')
  @OpenAPI({
    summary: 'Receive SERP webhook data',
    description:
      'Process and store the data received from the SERP webhook. Do not call this endpoint directly, it is meant to be called by Apify.',
  })
  @ResponseSchema(StandardResponse)
  async receiveSerpData(
    @Body() webhookData: SerpWebhookRequestBody
  ): Promise<StandardResponse> {
    const { defaultDatasetId, status, startedAt } = webhookData.resource;
    const actorRunId = webhookData.eventData.actorRunId;
    const { localeId, removeDuplicates = false } = webhookData;

    if (status !== 'SUCCEEDED') {
      return new StandardResponse(
        `The actor run was not successful. Status: ${status}`,
        true
      );
    }

    setTimeout(async () => {
      const run = await prisma.processedRun.create({
        data: {
          localeId,
          actorRunId,
          status,
        },
      });

      const data: ApifyGoogleSearchResult[] = await fetch(
        `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?clean=true&format=json&view=organic_results`
      ).then((res) => res.json());

      const filteredData = removeDuplicates
        ? this.filterDuplicateDomains(data) // Remove duplicate domains
        : data;

      const merchants = await prisma.merchant.findMany({
        where: {
          locale_relation: { id: localeId },
          disabledAt: null,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const validData = this.prepareSerpData(
        filteredData,
        actorRunId,
        localeId,
        merchants
      ); // Prepare the data for storage

      const errors: Record<string, any>[] = [];

      // Store the SERP data using upsert change localeId value
      for (const item of validData) {
        try {
          await prisma.targetPage.upsert({
            where: { url: item.url },
            create: {
              ...item,
              lastApifyRunAt: null,
            },
            update: {
              ...item,
              lastApifyRunAt: startedAt,
              updatedAt: new Date(),
            },
          });
        } catch (e) {
          errors.push({
            index: validData.indexOf(item),
            error: e,
            data: item,
          });
        }
      }

      await prisma.processedRun.update({
        where: { id: run.id },
        data: {
          resultCount: filteredData.length,
          createdCount: validData.length - errors.length || 0,
          errorCount: errors.length,
          processingErrors: errors,
          endedAt: new Date(),
          costInUsdMicroCents: getGoogleActorPriceInUsdMicroCents(
            filteredData.length
          ),
        },
      });

      if (errors.length > 0) {
        Sentry.captureException(
          `Errors occurred during processing run ${run.id} from SERP actor`,
          {
            extra: { errors },
          }
        );
      }
    }, 0);

    return new StandardResponse(
      'SERP data received successfully. Please check the logs for more details.',
      false
    );
  }

  // Remove duplicate domains from the SERP data to avoid duplicates
  private filterDuplicateDomains(
    data: ApifyGoogleSearchResult[]
  ): ApifyGoogleSearchResult[] {
    const domains: Set<string> = new Set();
    return data.filter((item) => {
      try {
        const url = new URL(item.url);
        const domain = url.hostname.replace('www.', '');
        if (domains.has(domain)) return false;
        domains.add(domain);
        return true;
      } catch (error) {
        Sentry.captureMessage(
          `Invalid URL format for SERP data: ${item.url}. Skipping.`
        );
        return false;
      }
    });
  }

  // Prepare the SERP data for storage
  private prepareSerpData(
    data: ApifyGoogleSearchResult[],
    actorRunId: string,
    localeId: string,
    merchants: any[]
  ) {
    return data
      .filter((item) => !!item.url)
      .map((item) => {
        const merchant: any = findMerchantBySearchTerm(
          item.searchQuery.term,
          merchants
        );
        const merchantId = merchant ? merchant.id : null;

        const data = {
          url: item.url,
          title: item.title,
          searchTerm: item.searchQuery.term,
          searchPosition: item.position,
          searchDomain: item.searchQuery.domain,
          apifyRunId: actorRunId,
          domain: new URL(item.url).hostname.replace('www.', ''),
          verified_locale: null as string | null,
          locale: { connect: { id: localeId } },
          merchant: { connect: { id: merchantId } },
        };

        if (item.searchQuery.term.startsWith('site:')) {
          const verifiedLocale = `${item.searchQuery.languageCode.toLowerCase()}_${item.searchQuery.countryCode.toUpperCase()}`;
          data.verified_locale = isValidLocale(verifiedLocale)
            ? verifiedLocale
            : (null as string | null);
        }

        return data;
      });
  }

  @Post('/tests')
  @OpenAPI({
    summary: 'Receive Test webhook data',
    description:
      'Store the data received from the TEST webhook. Do not call this endpoint directly, it is meant to be called by Apify.',
  })
  @ResponseSchema(StandardResponse)
  async receiveTestData(
    @Body() webhookData: TestWebhookRequestBody
  ): Promise<StandardResponse> {
    const apifyTestRunId = webhookData.eventData.actorRunId;
    const status = webhookData.resource.status;
    const { actorId } = webhookData;

    if (!actorId) {
      return new StandardResponse('actorId is a required field', true);
    }

    if (status !== 'SUCCEEDED') {
      Sentry.captureMessage(`Actor test ${apifyTestRunId} - status ${status}`);
    }

    try {
      await prisma.test.upsert({
        create: { apifyActorId: actorId, status, apifyTestRunId },
        update: { status, apifyTestRunId },
        where: { apifyActorId: actorId },
      });
    } catch (e) {
      Sentry.captureMessage(
        `Error saving actor test ${actorId} - ${JSON.stringify(e)}`
      );
    }
    return new StandardResponse(`Test data processed successfully.`, false);
  }
}

const getActorRunRequests = async (runId: string) => {
  const response = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/request-queue/requests?token=${process.env.APIFY_ORG_TOKEN_OBERST}`,
    {
      method: 'GET',
    }
  );

  if (!response.ok) {
    throw new Error(`Error fetching input: ${response.statusText}`);
  }

  const input = await response.json();

  if (input && input.data && input.data.items && input.data.items.length > 0)
    return input.data.items;

  return [];
};
