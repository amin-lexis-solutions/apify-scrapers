import fs from 'fs';
import path from 'path';

const directoryPath = __dirname;

// Array to store sources data
const sourcesData: any[] = [];

// Read the directory and import each .ts file
fs.readdirSync(directoryPath).forEach((file) => {
  if (file.endsWith('.ts') && file !== 'index.ts') {
    const moduleName = path.basename(file, '.ts');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require(`./${moduleName}`);

    if (module.default) {
      sourcesData.push(...module.default);
    } else {
      sourcesData.push(...module);
    }
  }
});
export interface SOURCES_DATA {
  apifyActorId: string;
  domains: any[];
  name: string;
  routes?: any[];
}

const validateSourcesData = (data: SOURCES_DATA[]) => {
  const apifyActorIdSet = new Set<string>();
  const nameSet = new Set<string>();
  const domainWarnings = new Map<string, number>();

  data.forEach((item) => {
    if (apifyActorIdSet.has(item.apifyActorId) && item.apifyActorId) {
      throw new Error(
        `Duplicate apifyActorId found: ${item.apifyActorId} in ${item.name} actor.`
      );
    }
    apifyActorIdSet.add(item.apifyActorId);

    if (nameSet.has(item.name)) {
      throw new Error(`Duplicate name found: ${item.name}.`);
    }
    nameSet.add(item.name);

    item.domains.forEach((item) => {
      if (domainWarnings.has(item.domain)) {
        domainWarnings.set(item.domain, domainWarnings.get(item.domain)! + 1);
      } else {
        domainWarnings.set(item.domain, 1);
      }
    });
  });

  domainWarnings.forEach((count, domain) => {
    if (count > 1) {
      console.warn(
        `Warning: Domain ${domain} is used ${count} times in sources. It should be used only once.`
      );
    }
  });
};

try {
  validateSourcesData(sourcesData);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  console.log('Exiting...');
  process.exit(1);
}

export const SOURCES_DATA = sourcesData as SOURCES_DATA[];
