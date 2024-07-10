/* eslint-disable no-console */
import dotenv from 'dotenv';
import path from 'path';
import { availableActorRuns } from '../utils/utils';
import fetch from 'node-fetch';

dotenv.config({ path: path.resolve(__dirname, '.env.cron') });

export const runActors = async () => {
  const maxConcurrency = await availableActorRuns();

  if (maxConcurrency < 1) {
    console.log('Max concurrency reached, skipping actors run');
    return;
  }

  fetch(`${process.env.BASE_URL}targets/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (process.env.API_SECRET as string),
    },
    body: JSON.stringify({ maxConcurrency }),
  })
    .then((data) => {
      if (data.status != 200) {
        throw new Error(`Failed to run actors with status ${data.status}`);
      }
      console.log(
        `🚀  Actors run successfully with concurrency ${maxConcurrency} `
      );
    })
    .catch((e) => console.error(e));
};

const main = async () => {
  try {
    await runActors();
  } catch (e) {
    console.log(e);
  }
};

main();
