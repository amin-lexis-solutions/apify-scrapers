import { Coupon, Prisma, PrismaClient } from '@prisma/client';
import { $Enums } from '@prisma/client';
import fetch from 'node-fetch';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { generateHash, validDateOrNull } from '../utils/utils';
import { StandardResponse, WebhookRequestBody } from '../utils/validators';

const prisma = new PrismaClient();

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

@JsonController()
export class WebhookController {
  @Post('/webhook')
  @OpenAPI({
    summary: 'Receive webhook data',
    description:
      'Process and store the data received from the webhook. Do not call this endpoint directly, it is meant to be called by Apify.',
  })
  @ResponseSchema(StandardResponse) // Apply @ResponseSchema at the method level
  @Authorized()
  async receiveData(
    @Body() webhookData: WebhookRequestBody
  ): Promise<StandardResponse> {
    const datasetId = webhookData.resource.defaultDatasetId;
    const actorId = webhookData.eventData.actorId;
    const actorRunId = webhookData.eventData.actorRunId;
    const status = webhookData.resource.status;

    const run = await prisma.processedRun.create({
      data: {
        actorId,
        actorRunId,
        status,
      },
    });

    setTimeout(async () => {
      const scrapedData = await fetchScrapedData(datasetId);
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
              sourceId: actorId,
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
    }, 0);

    return new StandardResponse('Data processed successfully', false);
  }
}

async function fetchScrapedData(datasetId: string) {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items`;
  const response = await fetch(url);
  return response.json();
}
