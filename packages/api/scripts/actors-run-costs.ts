/* eslint-disable no-console */
import dotenv from 'dotenv';
import { SOURCES_DATA } from '../config/actors';
import dayjs from 'dayjs';

dotenv.config();

const APIFY_GET_ALL_RUNS_URL = `https://api.apify.com/v2/actor-runs?token=${process.env.API_KEY_APIFY}&desc=true`;

const FINISHED_STATUSES = new Set(['SUCCEEDED', 'TIMED_OUT']);

export const main = async () => {
  const response = await fetch(APIFY_GET_ALL_RUNS_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch data from Apify: ${response.statusText}`);
  }

  const apifyActorRuns: any = await response.json();

  const startDate = dayjs('2024-07-08T00:00:00.000Z').toDate();
  const endDate = dayjs('2024-07-08T23:59:00.000Z').toDate();

  // get all running actors today and count them
  const runningActors = apifyActorRuns.data.items.filter((item: any) => {
    const itemDate = dayjs(item.startedAt).toDate(); // convert to Date object
    return (
      itemDate > startDate &&
      itemDate < endDate &&
      FINISHED_STATUSES.has(item.status)
    );
  });

  // match running actors with sources data by apifyActorId and get and count the usage cost of each actor run
  const runningActorsCosts = runningActors
    .map((actor: any) => {
      const source = SOURCES_DATA.find(
        (source) => source.apifyActorId === actor.actId
      );
      if (!source) {
        return null;
      }

      const cost = actor.usageTotalUsd || 0;
      return {
        name: source.name,
        cost,
        startDate: actor.startedAt,
      };
    })
    .filter((actor: any) => actor !== null);

  // group by actor name and sum the cost ord er by name
  const groupedActorsCosts = runningActorsCosts.reduce(
    (acc: any, actor: any) => {
      if (!acc[actor.name]) {
        acc[actor.name] = 0;
      }
      acc[actor.name] += actor.cost;
      return acc;
    },
    {}
  );

  // sort by actor name
  const sortedActorsCosts = Object.entries(groupedActorsCosts).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // print the result
  console.table(sortedActorsCosts);

  // show the total cost
  const totalCost = sortedActorsCosts.reduce(
    (acc, [, cost]) => acc + Number(cost),
    0
  );

  console.log('Total cost:', totalCost);
};

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
