import fetch from 'node-fetch';

type Merchant = {
  domain: string;
  name: string;
  id: number;
};

const API_URL =
  'https://europe-west1-data-warehouse-362613.cloudfunctions.net/bigquery_retrieval';

if (!process.env.OBERST_API_KEY) {
  throw new Error('Env variable OBERST_API_KEY is not set');
}

export async function getMerchantsForLocale(
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
