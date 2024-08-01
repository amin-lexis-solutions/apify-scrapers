/* eslint-disable no-console */
import dotenv from 'dotenv';
import { availableActorRuns, getEndpointBaseUrl } from '../utils/utils';

dotenv.config();

const findTargets = async () => {
  const maxConcurrency = Math.min(await availableActorRuns(), 5);

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

  fetch(`${getEndpointBaseUrl()}targets/find-n-locales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (process.env.API_SECRET as string),
    },
    body: JSON.stringify(payload),
  });
};

findTargets();
