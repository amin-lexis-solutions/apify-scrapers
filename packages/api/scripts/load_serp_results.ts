/* eslint-disable max-len */
/* eslint-disable no-console */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import fetch from 'node-fetch';
import ProgressBar from 'progress';

dotenv.config();

const actorsRuns = [
  'KqRLlBk5AP2GMI8gN',
  'F13yXTlFMLH85fQcQ',
  'S29ERktLJkvJYiCRq',
  'h81xGlP7QYZxKGQj2',
  'yhkhcPFlfHc1GHUbj',
  '1pBoaFbIh4vsMoCvg',
  'IPTwUThW8Nstt7sPZ',
  'OhKrn53a6K4yNZZbU',
  'CpUammhvkrvXcFt5b',
  'cZERkoQMhLdixf39L',
  'V5BUOoYhwObZhPuaa',
  'sHPCFSqEaT3F9qpjc',
  'h9oorbkNbYa2Surm8',
  'yK3uavVcXfTEhFT2k',
  'sCQdvr4c6Qy3hJ7Su',
  'ZUk4Zm0igewwkaXXc',
  'hxKogSQR1gBEErLoR',
  'k7rJfrkfkZgM17xaV',
  'Zbro6JmHl4yk8uYeu',
  'Vt1hfEjRAIkL0ikm5',
  'k78W7Jna1d6TXotr9',
  'ISsALjWmIHu2uxBGq',
  'VrDoQqtK3xV90vkeK',
  'OyzP9pBrHTsUe5GEN',
  '2wJibV2OcRcgGf8Ds',
  'bZ5UjEy0reqKwV0PN',
  'ubTkSh1xMwLqfnZPd',
  'bzSsza4idM5HmhUfX',
  'nxwjLh5halReFsNPg',
  'zl1vRrsFRLdcSe2hM',
  'eHxG3e8XfUblQFT7O',
  'yqP8qbb9f5HlQbdfk',
  'YkXB3S448ijewbFvR',
  '44UeZJ37pbbuHbyLe',
  'eTPomgfF3XaPyygaJ',
  'pz5v0ZhgWN5vbIy4j',
  'OphGrcrYNgKb8BOzI',
  'V72iXC04sTNRBbmpP',
  'gMakd1hggEnK58sxN',
  'sWC3p0KQofvvEm1r0',
  'wAwnPyqcVItf00gzt',
  'n1qpF5tdQEj2L9A0x',
  'cLwBMjggaA1oLVe85',
  'y2fDVi4axLdMv91d4',
  'sehlnLERZgNy5RQkM',
  'rw8WYA7R7Ert150ap',
  'o6j0jbWrmAddupDZP',
  '0ZElV3O7PLVi9Sn1j',
  'fKwpmlFyyUjdX1NaT',
  'kPYktzW6C8AYpczFG',
  '1KMG6eU32sTvK5fCF',
  'XZtY0YrbcnJp6YcaD',
  'ft4TBJjXaog6a6Ne8',
  'QYFRh4HSHBJ4vg1mG',
  'JbYdFMfp4fAqm17ps',
  'oCmBSiCuGMdEWvdzb',
  'AInWJb0yP4VJwy6N1',
  'MjG8XAYuKfGtnVXJv',
  'XcD2qlKbokZQr6gx1',
  'r9NuThijEW2Ullvmh',
  '32bWpWTQ4zHJ58nl7',
  'U2WUcbEV5uFkSuffh',
  'PIDFr31t5Rw22Chco',
  'MOeyfNxInC0jkdGvi',
  'hHZewkS6yUudSijmg',
  '4DsTjI2gdENA7Hcy1',
  'chLXiX3ceGiAnVEIr',
  'FWQn6YKYyY2kWdq7A',
  'vca5MR8uY8uXilCKv',
  'etXkvlWHvHTfLW58C',
  'HUKV5HGc7x8DXyrxi',
  'gp7st103x3p3ueKY6',
  'wIm9UCBDYjko4eOwZ',
  'Op7Qh07Ahon9DlKqJ',
  'CGcVaH48sVbhWtNtl',
  'Rehhg5tdi3ETq0o5a',
  'h1303Mz0DhNKO08jX',
  '83iV1Sq7iVETOe7qC',
  'l6fNW4IehRLKn8abY',
  '6b4F1xKF6DbEPJICw',
  'vpTrwjpDhdbZn4W4H',
];

const CHUNK_SIZE = 1000; // Number of items to process in a single batch

// Function to chunk an array into smaller arrays
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunkedArray: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunkedArray.push(array.slice(i, i + size));
  }
  return chunkedArray;
};

export const main = async () => {
  const startDate: Date = new Date();

  const folder = './data';
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }

  const locales = await prisma.targetLocale.findMany();

  const results: Record<string, number> = {};
  const invalidUrls: string[] = [];

  for (const runId of actorsRuns) {
    let localeId: any = null;
    const filePath = path.join(folder, `${runId}.json`);

    let apifyActorRuns: any;

    if (fs.existsSync(filePath)) {
      // Read data from file if it exists
      const rawData = fs.readFileSync(filePath, 'utf8');
      apifyActorRuns = JSON.parse(rawData);
    } else {
      // Fetch data from API if file does not exist
      const response = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${process.env.APIFY_ORG_TOKEN_OBERST}&clean=true&format=json&view=organic_results`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        console.error(`Error fetching data for runId: ${runId}`);
        continue;
      }

      apifyActorRuns = await response.json();

      // Save the fetched data to a file
      fs.writeFileSync(filePath, JSON.stringify(apifyActorRuns, null, 2));
    }

    results[runId] = 0;
    // Process the data in chunks to reduce stress on the database
    const chunkedData = chunkArray(apifyActorRuns, CHUNK_SIZE);
    const progressBar = new ProgressBar(':bar :current/:total :percent :etas', {
      total: chunkedData.length,
    });
    for (const chunk of chunkedData) {
      const promises = chunk.map(async (item: any) => {
        if (!localeId) {
          const locale = locales.find(
            (item_locale) =>
              item_locale.locale ===
              `${item.searchQuery.languageCode}_${item.searchQuery.countryCode}`
          );

          if (locale) {
            localeId = locale.id;
          } else {
            console.error(
              `Locale not found: ${item.searchQuery.languageCode}_${item.searchQuery.countryCode}`
            );
            return;
          }
        }

        // Validate URL
        try {
          new URL(item.url);
        } catch (e) {
          invalidUrls.push(item.url);
          return;
        }

        const data = {
          url: item.url,
          title: item.title,
          searchTerm: item.searchQuery.term,
          searchPosition: item.position,
          searchDomain: item.searchQuery.domain,
          apifyRunId: runId,
          domain: new URL(item.url).hostname.replace('www.', ''),
          locale: { connect: { id: localeId } },
          verified_locale: null as string | null,
        };

        try {
          await prisma.targetPage.upsert({
            where: { url: data.url },
            create: { ...data },
            update: { ...data, updatedAt: new Date() },
          });
          results[runId] = results[runId] + 1;
        } catch (e) {
          console.error(`Error processing SERP data: ${e}`);
        }
      });

      await Promise.all(promises); // Wait for all promises in the chunk to resolve

      progressBar.tick();
    }
    console.log(
      `Apify data processed for runId: ${runId} - Total records: ${results[runId]} \n`
    );
  }

  // Sun the total records processed
  const totalRecords = Object.values(results).reduce(
    (acc, val) => acc + val,
    0
  );
  console.log(
    `Total records processed: ${totalRecords} / ${actorsRuns.length} actors runs`
  );

  // count targetPage Db records updated
  const targetPages = await prisma.targetPage.count({
    where: { updatedAt: { gte: startDate } },
  });
  console.log(`Total targetPage records updated: ${targetPages}`);
  console.log(`Invalid URLs: ${invalidUrls.length}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
