/* eslint-disable no-console */
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import { prisma } from '../lib/prisma';
import dayjs from 'dayjs';
import { getEndpointBaseUrl } from '../utils/utils';
import fetch, { RequestInit, Response } from 'node-fetch';

dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.SENTRY_LOGGING === 'true',
  tracesSampleRate: 1.0,
});

const BASE_URL = getEndpointBaseUrl();

const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> => {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);
    if (response.ok) return response;
    if (i < retries - 1) await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('Failed to fetch after multiple attempts');
};

const processFailedRun = async (failedProcess: any) => {
  const postData = failedProcess.payload;
  const deleted = await prisma.processedRun.delete({
    where: { id: failedProcess.id },
  });

  if (!postData || Object.keys(postData).length === 0) {
    throw new Error('Invalid payload data');
  }

  if (!deleted) {
    throw new Error('Failed to delete processed run');
  }

  const endpointBaseUrl = `${BASE_URL}webhooks/coupons`;

  const response = await fetchWithRetry(endpointBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.API_SECRET}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({
      ...postData,
      eventData: {
        ...postData.eventData,
        retriesCount: failedProcess.retriesCount + 1,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    await prisma.processedRun.create({
      data: {
        ...failedProcess,
        payload: JSON.stringify(failedProcess.payload),
        processingErrors: JSON.stringify(failedProcess.processingErrors),
        retriesCount: failedProcess.retriesCount + 1,
      },
    });
    throw new Error(errorData.message || 'Failed to send webhook');
  }

  const responseData = await response.json();
  console.log('Response data:', responseData);
};

const main = async () => {
  try {
    const failedProcesses = await prisma.processedRun.findMany({
      where: {
        endedAt: null,
        payload: {
          not: {},
        },
        AND: [
          {
            OR: [
              {
                startedAt: {
                  lt: dayjs().subtract(1, 'hours').toDate(),
                },
                retriesCount: 0,
              },
              {
                startedAt: {
                  lt: dayjs().subtract(12, 'hours').toDate(),
                },
                retriesCount: 1,
              },
              {
                startedAt: {
                  lt: dayjs().subtract(24, 'hours').toDate(),
                },
                retriesCount: 2,
              },
            ],
          },
        ],
      },
      take: 2,
    });

    for (const failedProcess of failedProcesses) {
      await processFailedRun(failedProcess);
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    Sentry.captureException(error);
  }
};

main().catch((error) => {
  console.error('Unhandled error:', error.message);
  Sentry.captureException(error);
  process.exit(1);
});
