import * as Sentry from '@sentry/node';
import { Coupon, Prisma } from '@prisma/client';
import { $Enums } from '@prisma/client';
import fetch from 'node-fetch';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { ApifyGoogleSearchResult } from '../lib/apify';
import { prisma } from '../lib/prisma';
import { generateHash, validDateOrNull } from '../utils/utils';
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
    const { sourceId, localeId, targetIds } = webhookData;

    if (!sourceId) {
      return new StandardResponse('sourceId is a required field', true);
    }

    const run = await prisma.processedRun.create({
      data: {
        actorId: sourceId,
        actorRunId,
        status,
      },
    });

    setTimeout(async () => {
      const scrapedData = (await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${process.env.APIFY_TOKEN}`
      )
        .then((res) => res.json())
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
      const errors: Record<string, any>[] = [];

      for (let i = 0; i < scrapedData.length; i++) {
        const item = scrapedData[i];
        const id = generateHash(
          item.merchantName,
          item.idInSite,
          item.sourceUrl
        );

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

      // update target pages apifyRunScheduledAt to current date for the targetIds
      if (targetIds) {
        const targetIdsArr = targetIds.split(',');
        await prisma.targetPage.updateMany({
          where: { id: { in: targetIdsArr } },
          data: { lastApifyRunAt: new Date() },
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
    const { localeId } = webhookData;

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
    const filteredData: ApifyGoogleSearchResult[] = [];
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

    return new StandardResponse(
      `Data processed successfully. Created ${validData.length} / ${filteredData.length}  new records.`,
      false
    );
  }
}
