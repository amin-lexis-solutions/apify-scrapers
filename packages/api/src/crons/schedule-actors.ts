/* eslint-disable no-console */
import dotenv from 'dotenv';
import { availableActorRuns, getEndpointBaseUrl } from '../utils/utils';
import fetch from 'node-fetch';

dotenv.config();

export const runActors = async () => {
  const maxConcurrency = Math.min(await availableActorRuns(), 5);

  if (maxConcurrency < 1) {
    console.log('Max concurrency reached, skipping actors run');
    return;
  }

  fetch(`${getEndpointBaseUrl()}targets/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (process.env.API_SECRET as string),
    },
    body: JSON.stringify({ maxConcurrency }),
  })
    .then(async (data) => {
      if (data.status != 200) {
        const responseBody = await data.text();
        console.log(`Response Body: ${responseBody}`);
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
