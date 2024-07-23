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

  const payload: any = {
    localesCount: maxConcurrency,
  };

  if (process.env.NODE_ENV === 'development') {
    payload['limitDomainsPerLocale'] = 10;
  }

  fetch(`${process.env.BASE_URL}/targets/find-n-locales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (process.env.API_SECRET as string),
    },
    body: JSON.stringify(payload),
  });
};

findTargets();
