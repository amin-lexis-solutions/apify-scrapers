import fetch from 'node-fetch';

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
  locale: string
): Promise<Merchant[]> {
  return fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locale,
      api_key: process.env.OBERST_API_KEY,
    }),
  }).then((res) => res.json());
}
