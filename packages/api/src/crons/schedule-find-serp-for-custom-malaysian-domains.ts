import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env.cron') });

const MAX_CONCURRENT_RUNS = Number(process.env.MAX_CONCURRENT_RUNS);
const FINISHED_STATUSES = new Set([
  'SUCCEEDED',
  'FAILED',
  'ABORTED',
  'TIMED_OUT',
]);
const APIFY_GET_ALL_RUNS_URL = `https://api.apify.com/v2/actor-runs?token=${process.env.API_KEY_APIFY}&desc=true`;

const findTargets = async () => {
  const response = await fetch(APIFY_GET_ALL_RUNS_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  const apifyActorRuns: any = await response.json();

  const runningActorCount = apifyActorRuns.data.items.filter(
    (item: any) => !FINISHED_STATUSES.has(item.status)
  ).length;

  const maxConcurrency = MAX_CONCURRENT_RUNS - runningActorCount;

  if (maxConcurrency < 1) {
    console.log('Max concurrency reached, skipping actors run');
    return;
  }

  fetch(`${process.env.BASE_URL}targets/find-for-urls-and-locale`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (process.env.API_SECRET as string),
    },
    body: JSON.stringify({
      locale: 'en_MY',
      urls: ['cuponation.com.my', 'iprice.my', 'www.picodi.com/my'],
    }),
  });
};

findTargets();
