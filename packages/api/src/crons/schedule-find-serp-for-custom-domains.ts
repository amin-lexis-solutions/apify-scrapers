/* eslint-disable no-console */
import dotenv from 'dotenv';

import { Locale } from '../../config/locales';
import { availableActorRuns, getEndpointBaseUrl } from '../utils/utils';

dotenv.config();

const findTargets = async (locale: string) => {
  try {
    const maxConcurrency = await availableActorRuns();

    if (maxConcurrency < 1) {
      console.log('Max concurrency reached, skipping actors run');
      return;
    }

    fetch(`${getEndpointBaseUrl()}targets/find-for-urls-and-locale`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (process.env.API_SECRET as string),
      },
      body: JSON.stringify({
        locale: locale,
        urls: ['cuponation.ch', 'gutscheine.blick.ch', 'i-reductions.ch'],
        localeKeywords: true,
        resultsPerPage: 1,
        maxPagesPerQuery: 1,
      }),
    });
    console.log(
      `🚀  Actors run successfully with concurrency ${maxConcurrency} for ${locale}`
    );
  } catch (error) {
    console.log(error);
  }
};

const locales = [Locale.it_CH, Locale.de_CH, Locale.fr_CH];
for (const locale of locales) {
  findTargets(locale);
}
