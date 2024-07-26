/* eslint-disable no-console */
import dotenv from 'dotenv';
import { availableActorRuns } from '../utils/utils';

dotenv.config();

const findTargets = async () => {
  const maxConcurrency = await availableActorRuns();

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
