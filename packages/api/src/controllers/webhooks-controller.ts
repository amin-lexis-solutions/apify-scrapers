import * as Sentry from '@sentry/node';
import { Coupon, Prisma, $Enums } from '@prisma/client';
import fetch from 'node-fetch';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';
import dayjs from 'dayjs';
import { ApifyGoogleSearchResult } from '../lib/apify';
import { prisma } from '../lib/prisma';
import {
  generateHash,
  validDateOrNull,
  getToleranceMultiplier,
  removeDuplicateCoupons,
  getGoogleActorPriceInUsdMicroCents,
} from '../utils/utils';
import {
  SerpWebhookRequestBody,
  StandardResponse,
  TestWebhookRequestBody,
  WebhookRequestBody,
} from '../utils/validators';

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
    const actorRunId = webhookData.eventData.actorRunId;
    const { sourceId, localeId } = webhookData;

    if (!sourceId) {
      return new StandardResponse('sourceId is a required field', true);
    }

    const run = await prisma.processedRun.create({
      data: {
        sourceId,
        actorRunId,
        status,
      },
    });

    // Process data asynchronously to not block the response
    setTimeout(async () => {
      const scrapedData = await this.fetchScrapedData(
        defaultDatasetId,
        run.id,
        sourceId
      );
      if (!scrapedData) return;

      // Handle non-index pages
      const coupons = await this.handleNonIndexPages(scrapedData, actorRunId);

      // Process coupons
      const { couponStats, errors } = await this.processCoupons(
        coupons,
        sourceId,
        localeId
      );

      // Update coupon stats
      await this.updateCouponStats(scrapedData, sourceId);

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
          processedAt: new Date(),
          costInUsdMicroCents: Number(usageTotalUsd) * 1000000,
        },
      });

      // Send Sentry notification
      this.sendSentryNotification(
        scrapedData.length,
        couponStats,
        errors,
        run.id,
        sourceId
      );
    }, 0);

    return new StandardResponse('Data processed successfully', false);
  }

  // Fetch data from Apify
  private async fetchScrapedData(
    datasetId: string,
    runId: string,
    sourceId: string
  ) {
    try {
      const response = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${process.env.API_KEY_APIFY}`
      );
      const data = await response.json();

      // Remove duplicate coupons
      return removeDuplicateCoupons(data);
    } catch (error) {
      Sentry.captureMessage(
        `Error fetching data from Apify for run ${runId} from source ${sourceId}: ${error}`
      );
      return null;
    }
  }

  // Process and store the coupons
  private async processCoupons(
    scrapedData: any,
    sourceId: string,
    localeId: string
  ) {
    const now = new Date();
    const couponStats = {
      createdCount: 0,
      updatedCount: 0,
      unarchivedCount: 0,
      archivedCount: 0,
    };
    const errors: Record<string, any>[] = [];
    const targetPages = new Set<string>();

    for (const item of scrapedData) {
      const id = this.generateCouponId(item);
      targetPages.add(item.sourceUrl);

      const existingRecord = await prisma.coupon.findUnique({ where: { id } });
      const { updateData, archivedAt, archivedReason } = this.prepareUpdateData(
        item,
        existingRecord,
        now
      );

      try {
        await prisma.coupon.upsert({
          where: { id },
          update: updateData,
          create: this.prepareCreateData(
            item,
            sourceId,
            localeId,
            id,
            now,
            archivedAt,
            archivedReason
          ),
        });

        // Count the number of created, updated, archived and unarchived records for the stats
        this.updateCouponStatsCount(couponStats, existingRecord, updateData);
      } catch (error) {
        errors.push({
          index: scrapedData.indexOf(item),
          error: error,
        });
      }
    }

    // Update lastApifyRunAt for target pages
    if (targetPages.size > 0) {
      const targetPagesArray = Array.from(targetPages);
      await prisma.targetPage.updateMany({
        where: { url: { in: targetPagesArray } },
        data: { lastApifyRunAt: dayjs().toDate() },
      });
    }

    return { couponStats, errors, targetPages };
  }

  // Generate a unique ID for the coupon
  private generateCouponId(item: any) {
    if (!item.idInSite) {
      item.idInSite = `${item.merchantName} ${item.title} ${item.domain}`
        .replace(/[^a-zA-Z0-9]/g, '')
        .replace(/\s+/g, '');
    }
    return generateHash(item.merchantName, item.idInSite, item.sourceUrl);
  }

  // Prepare the coupons for updates and creation
  private prepareUpdateData(
    item: any,
    existingRecord: Coupon | null,
    now: Date
  ) {
    const updateData: Prisma.CouponUpdateInput = { lastSeenAt: now };
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
          } else if (existingRecord?.isExpired) {
            archivedAt = null;
            archivedReason = 'unexpired';
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
        }

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
    sourceId: string,
    localeId: string,
    id: string,
    now: Date,
    archivedAt: Date | null,
    archivedReason: $Enums.ArchiveReason | null
  ) {
    return {
      id,
      sourceId,
      localeId,
      idInSite: item.idInSite,
      domain: item.domain || null,
      merchantName: item.merchantName,
      title: item.title || null,
      description: item.description || null,
      termsAndConditions: item.termsAndConditions || null,
      expiryDateAt: validDateOrNull(item.expiryDateAt) || null,
      code: item.code || null,
      startDateAt: validDateOrNull(item.startDateAt) || null,
      sourceUrl: item.sourceUrl || null,
      isShown: item.isShown || null,
      isExpired: item.isExpired || null,
      isExclusive: item.isExclusive || null,
      firstSeenAt: now,
      lastSeenAt: now,
      archivedAt: archivedAt,
      archivedReason: archivedReason || null,
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
  private async updateCouponStats(coupons: any, sourceId: string) {
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

    const updatePromises = Object.keys(couponStats).map(async (sourceUrl) => {
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
    });

    await Promise.all(updatePromises);

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
        new Error(`Error saving coupon stats for source ${sourceId}`),
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
        new Error(`Anomalies detected for source ${sourceId}`),
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
        new Error(`Non-index pages detected on this actor run ${actorRunId}`),
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
    sourceId: string
  ) {
    if (resultCount === 0) {
      Sentry.captureMessage(
        `No data was processed for run ${runId} from source ${sourceId}`
      );
    }
    if (errors.length > 0) {
      Sentry.captureMessage(
        `Errors occurred during processing run ${runId} from source ${sourceId}`
      );
    }
    if (resultCount !== couponStats.createdCount + couponStats.updatedCount) {
      Sentry.captureMessage(
        `Not all data was processed for run ${runId} from source ${sourceId}`
      );
    }
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
    const { defaultDatasetId, status } = webhookData.resource;
    const actorRunId = webhookData.eventData.actorRunId;
    const { localeId, removeDuplicates = true } = webhookData;

    if (status !== 'SUCCEEDED') {
      return new StandardResponse(
        `The actor run was not successful. Status: ${status}`,
        true
      );
    }

    const data: ApifyGoogleSearchResult[] = await fetch(
      `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?clean=true&format=json&view=organic_results`
    ).then((res) => res.json());

    const filteredData = removeDuplicates
      ? this.filterDuplicateDomains(data) // Remove duplicate domains
      : data;
    const validData = this.prepareSerpData(filteredData, actorRunId, localeId); // Prepare the data for storage

    for (const item of validData) {
      try {
        await prisma.targetPage.upsert({
          where: { url: item.url },
          create: { ...item, lastApifyRunAt: null },
          update: { ...item, updatedAt: new Date() },
        });
      } catch (e) {
        console.error(`Error processing SERP data: ${e}`);
      }
    }

    await prisma.processedRun.create({
      data: {
        localeId,
        actorRunId,
        status,
        resultCount: filteredData.length,
        createdCount: validData.length,
        processedAt: new Date(),
        costInUsdMicroCents: getGoogleActorPriceInUsdMicroCents(
          filteredData.length
        ),
      },
    });

    return new StandardResponse(
      `Data processed successfully. Created ${validData.length} / ${filteredData.length} new records.`,
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
    localeId: string
  ) {
    return data
      .filter((item) => !!item.url)
      .map((item) => ({
        url: item.url,
        title: item.title,
        searchTerm: item.searchQuery.term,
        searchPosition: item.position,
        searchDomain: item.searchQuery.domain,
        apifyRunId: actorRunId,
        domain: new URL(item.url).hostname.replace('www.', ''),
        localeId,
      }));
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
