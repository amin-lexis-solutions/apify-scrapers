import * as Sentry from '@sentry/node';
import { Coupon, Prisma } from '@prisma/client';
import { $Enums } from '@prisma/client';
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
  @ResponseSchema(StandardResponse) // Apply @ResponseSchema at the method level
  async receiveData(
    @Body() webhookData: WebhookRequestBody
  ): Promise<StandardResponse> {
    const datasetId = webhookData.resource.defaultDatasetId;
    const actorRunId = webhookData.eventData.actorRunId;
    const status = webhookData.resource.status;
    const usageTotalUsd = webhookData.resource.usageTotalUsd;
    const { sourceId, localeId } = webhookData;

    const targetPages = new Set<string>();

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

    setTimeout(async () => {
      let scrapedData = (await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${process.env.API_KEY_APIFY}`
      )
        .then(async (res) => {
          const data = await res.json();
          return removeDuplicateCoupons(data);
        })
        .catch((e) => {
          Sentry.captureMessage(
            `Error fetching data from Apify for run ${run.id} from source ${sourceId}: ${e}`
          );
          return {};
        })) as any;

      const now = new Date();

      let createdCount = 0,
        updatedCount = 0,
        unarchivedCount = 0,
        archivedCount = 0;
      const couponStats = {} as any;
      const errors: Record<string, any>[] = [];

      const nonIndexPages = scrapedData.filter(
        (item: any) => item.__isNotIndexPage
      );
      scrapedData = scrapedData.filter((item: any) => !item.__isNotIndexPage);

      for (let i = 0; i < scrapedData.length; i++) {
        const item = scrapedData[i];
        // generate idInSite if it is not provided temporarily until fixed by the source
        if (!item.idInSite) {
          item.idInSite = `${item.merchantName} ${item.title} ${item.domain}` // combine merchantName, title and domain
            .replace(/[^a-zA-Z0-9]/g, '') // remove special characters
            .replace(/\s+/g, ''); // remove spaces
        }
        const id = generateHash(
          item.merchantName,
          item.idInSite,
          item.sourceUrl
        );

        targetPages.add(item.sourceUrl);

        // increment the count of the coupon in the stats
        couponStats[item.sourceUrl] = couponStats[item.sourceUrl] || {
          count: 0,
        };
        couponStats[item.sourceUrl].count++;

        const existingRecord: Coupon | null = await prisma.coupon.findUnique({
          where: { id },
        });

        const updateData: Prisma.CouponUpdateInput = {
          lastSeenAt: now,
        };

        let archivedAt = null;
        let archivedReason:
          | Prisma.NullableEnumArchiveReasonFieldUpdateOperationsInput
          | $Enums.ArchiveReason
          | null = null;

        for (const [key, origValue] of Object.entries(item)) {
          let value = origValue;
          if (updatableFields.includes(key as keyof Coupon)) {
            if (key === 'isExpired' && typeof value === 'boolean') {
              if (value === true) {
                // newly expired items are archived both when they are first seen and when they are updated
                archivedAt = now;
                archivedReason = 'expired';
              } else {
                if (
                  existingRecord !== null &&
                  existingRecord.isExpired === true
                ) {
                  // newly not expired items, which was expired are unarchived and set 'unexpired' on update
                  archivedAt = null;
                  archivedReason = 'unexpired';
                }
              }
            }
            if (
              key === 'title' &&
              typeof value === 'string' &&
              value.trim() !== '' &&
              existingRecord !== null &&
              existingRecord.title !== null &&
              existingRecord.title.trim() !== value.trim() &&
              existingRecord.isExpired === true
            ) {
              // if title is changed, items, which was expired are unarchived and set 'unexpired' on update
              archivedAt = null;
              archivedReason = 'unexpired';
            }
            updateData.archivedAt = archivedAt;
            updateData.archivedReason = archivedReason;
            if (
              (key === 'expiryDateAt' || key === 'startDateAt') &&
              typeof value === 'string'
            ) {
              value = validDateOrNull(value as string); // ensure that date is in ISO format
            }
            (updateData as any)[key] = value || null;
          }
        }

        const updatedFieldsCount = existingRecord
          ? Object.keys(updateData)
              .filter((key) => key !== 'lastSeenAt' && key !== 'archivedAt')
              .filter((key) => {
                const existingValue = (existingRecord as any)[key];
                const newValue = (updateData as any)[key];

                if (existingValue instanceof Date) {
                  return (
                    existingValue.getTime() !== new Date(newValue).getTime()
                  );
                }

                return existingValue !== newValue;
              }).length
          : 0;

        try {
          await prisma.coupon.upsert({
            where: { id },
            update: updateData,
            create: {
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
            },
          });

          if (existingRecord === null) {
            createdCount++;
          } else if (!existingRecord.archivedAt && updateData.archivedAt) {
            archivedCount++;
          } else if (existingRecord.archivedAt && !updateData.archivedAt) {
            unarchivedCount++;
          } else if (updatedFieldsCount > 0) {
            updatedCount++;
          }
        } catch (e: any) {
          errors.push({ index: i, error: e.toString() });
        }
      }

      // Calculate stats and detect anomalies if there are any coupons
      if (scrapedData.length > 0) {
        // Calculate stats for each source
        const updatePromises = Object.keys(couponStats).map(
          async (sourceUrl) => {
            const couponCount = couponStats[sourceUrl].count;

            // Fetch historical data for the source from the last 14 days
            const ANOMALY_DETECTION_DAYS =
              Number(process.env.ANOMALY_DETECTION_DAYS) || 14;

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

            // Calculate the average and handel the case where all counts are the same or no counts are provided
            const averageCount =
              counts.length > 0
                ? counts.reduce((a, b) => a + b) / counts.length
                : couponCount;

            // Calculate the tolerance multiplier based on the average count
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

            // Update the couponStats object with the new calculated values
            couponStats[sourceUrl] = {
              ...couponStats[sourceUrl],
              historical: counts,
              surgeThreshold,
              plungeThreshold,
              anomalyType,
            };
          }
        );

        // Wait for all updates to complete
        await Promise.all(updatePromises);

        // Now that all updates are complete, proceed with database operations
        const statsData = Object.keys(couponStats).map((sourceUrl) => ({
          sourceUrl,
          couponsCount: couponStats[sourceUrl].count,
          surgeThreshold: couponStats[sourceUrl].surgeThreshold,
          plungeThreshold: couponStats[sourceUrl].plungeThreshold,
        }));

        try {
          await prisma.couponStats.createMany({ data: statsData });
        } catch (e) {
          // If the stats creation fails, log the error and statsData and continue
          Sentry.captureMessage(
            `Error creating coupon stats for source ${sourceId} :
           ${JSON.stringify(statsData)}  : ${e} `
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
          Sentry.captureMessage(
            `Anomalies detected for source ${sourceId}: ${JSON.stringify(
              anomaliesData
            )}`
          );
        }
      }

      // Mark the nonIndexPages for the targetPages
      if (nonIndexPages.length > 0) {
        const targetPagesArray = nonIndexPages.map((item: any) => item?.__url);

        // Disable the targetPages that are marked as non-index and not disabled yet
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
        // Log a warning to Sentry if non-index pages are detected
        Sentry.captureException(
          new Error(
            `Non-index pages detected on this actor run ${actorRunId}`
          ) as any,
          {
            extra: { nonIndexPages },
          }
        );
      }

      // update lastApifyRunAt for the targetPages
      if (targetPages.size > 0) {
        const targetPagesArray = Array.from(targetPages);
        await prisma.targetPage.updateMany({
          where: { url: { in: targetPagesArray } },
          data: { lastApifyRunAt: dayjs().toDate() },
        });
      }

      await prisma.processedRun.update({
        where: { id: run.id },
        data: {
          createdCount,
          updatedCount,
          archivedCount,
          unarchivedCount,
          resultCount: scrapedData.length,
          errorCount: errors.length,
          processingErrors: errors,
          processedAt: new Date(),
          costInUsdMicroCents: Number(usageTotalUsd) * 1000000,
        },
      });

      // if resultCount is 0, the run is considered failed throw an warning to Sentry
      if (scrapedData.length === 0) {
        Sentry.captureMessage(
          `No data was processed for run ${run.id} from source ${sourceId}`
        );
      }
      if (errors.length > 0) {
        Sentry.captureMessage(
          `Errors occurred during processing run ${run.id} from source ${sourceId}`
        );
      }
      // if resultCount not equal to createdCount + updatedCount, the run is considered failed throw an warning to Sentry
      if (scrapedData.length !== createdCount + updatedCount) {
        Sentry.captureMessage(
          `Not all data was processed for run ${run.id} from source ${sourceId}`
        );
      }
    }, 0);

    return new StandardResponse('Data processed successfully', false);
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
    const datasetId = webhookData.resource.defaultDatasetId;
    const actorRunId = webhookData.eventData.actorRunId;
    const status = webhookData.resource.status;
    const { localeId, removeDuplicates = true } = webhookData;

    if (status !== 'SUCCEEDED') {
      return new StandardResponse(
        `The actor run was not successful. Status: ${status}`,
        true
      );
    }

    const data: ApifyGoogleSearchResult[] = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&view=organic_results`
    ).then((res) => res.json());

    // Filter out duplicate domains from the SERP results
    const filteredData: ApifyGoogleSearchResult[] = removeDuplicates
      ? []
      : data;
    if (removeDuplicates) {
      const domains: Set<string> = new Set();
      for (const item of data) {
        try {
          const url = new URL(item.url);
          const domain = url.hostname.replace('www.', '');
          if (domains.has(domain)) continue;
          filteredData.push(item);
          domains.add(domain);
        } catch (e) {
          Sentry.captureMessage(
            ` ActorRun ID ${actorRunId} : Invalid URL format for SERP data: ${item.url} . Skipping.`
          );
          continue;
        }
      }
    }
    // Process the data and store it in the database
    const validData: any = filteredData
      .filter((item) => !!item.url)
      .map((item) => {
        return {
          url: item.url,
          title: item.title,
          searchTerm: item.searchQuery.term,
          searchPosition: item.position,
          searchDomain: item.searchQuery.domain,
          apifyRunId: actorRunId,
          domain: new URL(item.url).hostname.replace('www.', ''),
          localeId,
        };
      });

    validData?.forEach(async (item: any) => {
      try {
        await prisma.targetPage.upsert({
          where: { url: item.url },
          create: {
            ...item,
            lastApifyRunAt: null,
          },
          update: {
            ...item,
            updatedAt: new Date(),
          },
        });
      } catch (e) {
        console.error(`Error processing SERP data: ${e}`);
      }
    });

    // Update the processedRun record
    await prisma.processedRun.create({
      data: {
        localeId: localeId,
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
      `Data processed successfully. Created ${validData.length} / ${filteredData.length}  new records.`,
      false
    );
  }
}
