import dotenv from 'dotenv';
import { SOURCES_DATA } from '../config/actors';

dotenv.config();

// write script that check shared actors between on apify account and actors in the sources data

const APIFY_GET_ALL_ACTORS_URL = `https://api.apify.com/v2/acts?token=${process.env.API_KEY_APIFY}&desc=true`;

export const main = async () => {
  const response = await fetch(APIFY_GET_ALL_ACTORS_URL, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch data from Apify: ${response.statusText}`);
  }

  const apifyActors: any = await response.json();

  // get all actors names and set shared if  exist in  apifyActors
  const sharedActors = SOURCES_DATA.map((source) => {
    const sharedActor = apifyActors.data.items.find(
      (actor: any) =>
        actor.id === source.apifyActorId &&
        actor.username === 'lexis-solutions' &&
        actor.name === source.name + '-scraper'
    );
    return sharedActor
      ? { apifyActorId: source.apifyActorId, name: source.name, shared: '✅' }
      : { apifyActorId: source.apifyActorId, name: source.name, shared: '❌' };
  });

  console.log('Shared actors:');
  console.table(sharedActors);

  if (sharedActors.some((actor) => actor.shared === '❌')) {
    throw new Error('Some actors are not shared');
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
