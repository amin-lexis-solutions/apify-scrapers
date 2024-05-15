import fetch from 'node-fetch';
import { getMerchantName } from '@api/utils/utils';

type Merchant = {
  domain: string;
  name: string;
};

const API_URL =
  'https://europe-west1-data-warehouse-362613.cloudfunctions.net/bigquery_retrieval';

if (!process.env.OBERST_API_KEY) {
  throw new Error('Env variable OBERST_API_KEY is not set');
}

export async function getMerchantsForLocale(
  locale: string,
  empty_Name = false
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

  if (!empty_Name) {
    return merchantMyResponse.map((merchant: any) => {
      if (merchant.name === '') {
        return {
          domain: merchant.domain,
          name: getMerchantName(merchant.domain),
        };
      }
      return {
        domain: merchant.domain,
        name: merchant.name,
      };
    });
  }

  return merchantMyResponse;
}
