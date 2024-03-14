import dotenv from 'dotenv';

const parseData = dotenv.config({ path: '/app/packages/api/.env' });

const envData = parseData.parsed || undefined;

if (envData === undefined) throw new Error('The .env file could not be parsed');

const MAX_CONCURRENT_RUNS = 2;
const FINISHED_STATUSES = new Set([
  'SUCCEEDED',
  'FAILED',
  'ABORTED',
  'TIMED_OUT',
]);
const APIFY_GET_ALL_RUNS_URL = `https://api.apify.com/v2/actor-runs?token=${envData.API_KEY_APIFY}&desc=true`;

const findActors = async () => {
  const response = await fetch(APIFY_GET_ALL_RUNS_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const apifyActorRuns: any = await response.json();

  const runningActorCount = apifyActorRuns.data.items.filter(
    (item: any) => !FINISHED_STATUSES.has(item.status)
  ).length;

  const maxConcurrency = MAX_CONCURRENT_RUNS - runningActorCount;

  if (maxConcurrency < 1) return;

  fetch(`${envData.BASE_URL}/targets/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: envData.API_SECRET as string,
    },
    body: JSON.stringify({ maxConcurrency }),
  });
};

findActors();
