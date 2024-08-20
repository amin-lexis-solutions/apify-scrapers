#!/usr/bin/env node
/* eslint-disable no-console */

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
    try {
      console.log(`Attempting to create directory: ${tempDir}`);
      await fs.mkdir(tempDir, { recursive: true });
      console.log(`Directory created successfully: ${tempDir}`);
    } catch (error) {
      console.error(`Failed to create directory: ${tempDir}`, error);
    }
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
      path.join(actorDir, 'INPUT_SCHEMA.json'),
      JSON.stringify(await getActorInputSpec(actorId), null, 2)
    ),
    fs.writeFile(path.join(tempDir, 'Dockerfile'), dockerfile),
  ]);

  // ls -la
  console.log(await fs.readdir(tempDir));
  console.log(await fs.readdir(actorDir));
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
    environmentVariables: {
      BASE_URL: process.env.BASE_URL,
      API_SECRET: process.env.API_SECRET,
      SENTRY_DSN_ACTORS: process.env.SENTRY_DSN_ACTORS,
    },
    storages: {
      dataset: './output.json',
    },
  };
}

/**
 * Fetches the input specification for an source based on its identifier.
 * This function assembles the scraping configuration, including start URLs
 * fetched dynamically from an API, and sets up proxy configuration.
 *
 * @param {string} sourceName - The name of the source to fetch the input spec for.
 * @returns {Object} The input specification schema for the actor.
 */
async function getActorInputSpec(sourceName) {
  try {
    // Configuration for the API request.
    const BASE_URL = process.env.BASE_URL;
    const API_SECRET = process.env.API_SECRET;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_SECRET}`,
    };

    // Construct the URL and fetch options.
    const url = `${BASE_URL}tests/get-sample-start-url-for-source-name?name=${sourceName}`;
    const options = { method: 'GET', headers };

    // Fetch the dynamic start URLs and handle the response.
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

    const data = await response.json();
    console.log('Received prefill data:', data);

    const prefill = data.data?.startUrls || [
      {
        url: 'https://www.example.com',
        metadata: {
          targetPageId: '123',
          targetPageUrl: 'https://www.example.com',
          verifyLocale: 'en_US',
          merchantId: '123',
        },
      },
    ];

    return {
      title: `${actorId} scraper`,
      description: 'Configuration for scraping activities.',
      type: 'object',
      schemaVersion: 1,
      properties: {
        startUrls: {
          sectionCaption: 'Basic configuration',
          title: 'Start URLs',
          type: 'array',
          description:
            'A list of URLs from which the scraper will start processing.',
          prefill,
          editor: 'requestListSources',
        },
        proxyConfiguration: {
          title: 'Proxy Configuration',
          type: 'object',
          description:
            'Configuration details for the proxy used by the scraper.',
          editor: 'proxy',
        },
      },
      required: ['startUrls'],
    };
  } catch (error) {
    throw new Error(`Failed to fetch prefill data: ${error}`);
  }
}
