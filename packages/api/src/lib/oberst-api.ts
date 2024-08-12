import fetch from 'node-fetch';
import env from 'dotenv';
import { prisma } from '@api/lib/prisma';
import dayjs from 'dayjs';
env.config();

type Merchant = {
  domain: string;
  name: string;
  id: number | bigint;
};

const API_URL =
  'https://europe-west1-data-warehouse-362613.cloudfunctions.net/bigquery_retrieval';

if (!process.env.OBERST_API_KEY) {
  throw new Error('Env variable OBERST_API_KEY is not set');
}

export async function getUnScrapedMerchantByLocale(
  locale: string
): Promise<Merchant[]> {
  const fourWeeksAgo = dayjs().subtract(4, 'weeks').toDate();

  const merchants = await prisma.merchant.findMany({
    where: {
      disabledAt: null,
      locale: locale,
    },
    select: {
      oberst_id: true,
      name: true,
      domain: true,
      _count: {
        select: {
          targetPages: {
            where: {
              updatedAt: {
                gt: fourWeeksAgo,
              },
            },
          },
        },
      },
    },
  });

  const filteredMerchants = merchants.filter(
    (merchant) => merchant._count.targetPages === 0
  );

  return filteredMerchants.map((merchant) => ({
    domain: merchant.domain,
    name: merchant.name,
    id: merchant.oberst_id,
  }));
}

export async function getMerchantsForLocale(
  locale: string
): Promise<Merchant[]> {
  const merchants = await prisma.merchant.findMany({
    where: {
      locale,
    },
  });

  return merchants?.map((merchant) => ({
    domain: merchant.domain,
    name: merchant.name,
    id: merchant.oberst_id,
  })) as Merchant[] | [];
}

export async function fetchMerchantByLocale(
  locale: string,
  ensureNameIsPresent = true
): Promise<Merchant[]> {
  const merchantMyResponse = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locale,
      api_key: process.env.OBERST_API_KEY,
    }),
  })
    .then((res) => res.json())
    .catch((err) => {
      console.error('Error fetching merchants from Oberst API', err);
      return [];
    });

  if (ensureNameIsPresent) {
    return merchantMyResponse.map((merchant: any) => {
      if (!merchant.name || merchant.name === '') {
        return {
          domain: merchant.domain,
          name: merchant.domain,
          id: merchant.id,
        };
      }
      return {
        domain: merchant.domain,
        name: merchant.name,
        id: merchant.id,
      };
    });
  }

  return merchantMyResponse;
}
