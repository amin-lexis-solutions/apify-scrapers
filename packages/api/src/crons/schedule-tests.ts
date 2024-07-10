/* eslint-disable no-console */
import dotenv from 'dotenv';
import path from 'path';
import { availableActorRuns } from '../utils/utils';

dotenv.config({ path: path.resolve(__dirname, '.env.cron') });

(async () => {
  try {
    const maxConcurrency = await availableActorRuns();

    if (maxConcurrency < 1) {
      console.log('Max concurrency reached, skipping actors run');
      return;
    }

    fetch(`${process.env.BASE_URL}tests/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (process.env.API_SECRET as string),
      },
      body: JSON.stringify({ maxConcurrency }),
    })
      .then(() => {
        console.log(
          `🚀  Actors test successfully with concurrency ${maxConcurrency} `
        );
      })
      .catch((e) => console.error(e));
  } catch (e) {
    console.log(e);
  }
})();
