import { Coupon, Prisma, PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { generateHash } from '../utils/utils';
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
    const apifyStatus = webhookData.resource.status;

    const existingRun = await prisma.processedRun.findUnique({
      where: { actorRunId },
    });

    if (existingRun) {
      return new StandardResponse('Run already processed', false);
    }

    await prisma.processedRun.create({
      data: {
        actorId: actorId,
        actorRunId: actorRunId,
        status: apifyStatus,
      },
    });

    setTimeout(async () => {
      const scrapedData = await fetchScrapedData(datasetId);
      const now = new Date();

      for (const item of scrapedData) {
        const id = generateHash(
          item.merchantName,
          item.idInSite,
          item.sourceUrl
        );

        const updateData: Prisma.CouponUpdateInput = {
          lastSeenAt: now,
        };

        for (const [key, value] of Object.entries(item)) {
          if (updatableFields.includes(key as keyof Coupon)) {
            (updateData as any)[key] = value || null;
          }
        }

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
            expiryDateAt: item.expiryDateAt || null,
            code: item.code || null,
            startDateAt: item.startDateAt || null,
            sourceUrl: item.sourceUrl || null,
            isShown: item.isShown || null,
            isExpired: item.isExpired || null,
            isExclusive: item.isExclusive || null,
            firstSeenAt: now,
            lastSeenAt: now,
            archivedAt: null,
          },
        });
      }
    }, 0);

    return new StandardResponse('Data processed successfully', false);
  }
}

async function fetchScrapedData(datasetId: string) {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items`;
  const response = await fetch(url);
  return response.json();
}
