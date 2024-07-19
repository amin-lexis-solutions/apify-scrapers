#!/usr/bin/env node

const fs = require('fs').promises;
const { exec } = require('child_process');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);

const [actorId, actorType, dryRunFlag] = process.argv.slice(2);
const actorFolder = path.resolve(__dirname, `../packages/${actorId}`);
const sharedFolder = path.resolve(__dirname, `../packages/shared`);
const tempDir = path.resolve(__dirname, `../${actorId}-scraper`);

const validateInputs = () => {
  if (!actorId || !actorType) {
    console.error(
      'Usage: deploy-apify.js <actorId> <actorType=cheerio|puppeteer>'
    );
    process.exit(1);
  }
  if (!['cheerio', 'puppeteer'].includes(actorType)) {
    console.error('Invalid actor type. Must be "cheerio" or "puppeteer"');
    process.exit(1);
  }
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const setupTempDirectory = async () => {
  if (!(await fileExists(tempDir))) {
    await fs.mkdir(tempDir, { recursive: true });
  }
  const tempPackageDir = path.resolve(tempDir, 'packages');
  await fs.mkdir(tempPackageDir, { recursive: true });
  await Promise.all([
    fs.cp(sharedFolder, path.join(tempPackageDir, 'shared'), {
      recursive: true,
    }),
    fs.cp(actorFolder, path.join(tempPackageDir, actorId), { recursive: true }),
    fs.copyFile(
      path.resolve(__dirname, '../package.prod.json'),
      path.join(tempDir, 'package.prod.json')
    ),
    fs.copyFile(
      path.resolve(__dirname, '../package.json'),
      path.join(tempDir, 'package.json')
    ),
    fs.copyFile(
      path.resolve(__dirname, '../yarn.lock'),
      path.join(tempDir, 'yarn.lock')
    ),
    fs.cp(path.resolve(__dirname, '../.actor'), path.join(tempDir, '.actor'), {
      recursive: true,
    }),
  ]);
};

const prepareActorFiles = async () => {
  const actorDir = path.join(tempDir, '.actor');
  if (!(await fileExists(actorDir))) {
    await fs.mkdir(actorDir, { recursive: true });
  }
  const dockerfileTemplate = await fs.readFile(
    path.resolve(__dirname, `../docker/Dockerfile.${actorType}.template`),
    'utf8'
  );
  const dockerfile = dockerfileTemplate.replace(/{{actorId}}/g, actorId);
  await Promise.all([
    fs.writeFile(
      path.join(actorDir, 'actor.json'),
      JSON.stringify(getActorSpec(actorId), null, 2)
    ),
    fs.writeFile(
      path.join(actorDir, 'input.json'),
      JSON.stringify(getActorInputSpec(actorId), null, 2)
    ),
    fs.writeFile(path.join(actorDir, 'Dockerfile'), dockerfile),
  ]);
};

const deployActor = async () => {
  if (dryRunFlag === '--dry-run') {
    console.info('Dry run complete. Exiting...');
    return;
  }
  try {
    const { stdout, stderr } = await execAsync('npx apify push', {
      cwd: tempDir,
    });
    console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.error('Error during apify push:', error);
  } finally {
    await cleanup();
  }
};

const cleanup = async () => {
  console.info('Cleaning up...');
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.info(`Successfully deleted ${tempDir}`);
  } catch (error) {
    console.error(`Error deleting ${tempDir}:`, error);
  }
};

const main = async () => {
  validateInputs();
  await setupTempDirectory();
  await prepareActorFiles();
  await deployActor();
};

process.on('SIGINT', cleanup);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function getActorSpec(actorId) {
  return {
    actorSpecification: 1,
    name: `${actorId}-scraper`,
    title: `${actorId} Scraper`,
    version: '0.0',
    input: './input.json',
    environmentVariables: {
      BASE_URL: process.env.BASE_URL,
      API_SECRET: process.env.API_SECRET,
    },
    storages: {
      dataset: './output.json',
    },
  };
}

function getActorInputSpec(actorId) {
  return {
    title: `${actorId} scraper`,
    description: '',
    type: 'object',
    schemaVersion: 1,
    properties: {
      startUrls: {
        sectionCaption: 'Basic configuration',
        title: 'Start URLs',
        type: 'array',
        description:
          'A static list of URLs to scrape. For details, see the Start URLs section in the README.',
        prefill: [
          {
            url: 'https://apify.com',
            metadata: {
              locale: 'en_US',
              targetPageId: 'test',
              localeId: 'test',
            },
          },
        ],
        editor: 'requestListSources',
      },
      proxyConfiguration: {
        title: 'Proxy Configuration',
        type: 'object',
        description: 'Your proxy configuration from Apify',
        editor: 'proxy',
      },
    },
    required: ['startUrls'],
  };
}
