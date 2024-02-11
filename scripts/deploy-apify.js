#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Parse actorId from first argument
const actorId = process.argv[2];

// Parse actor type from second argument = cheerio | puppeteer
const actorType = process.argv[3];

// Check if dry run
const dryRun = process.argv[4] === '--dry-run';

if (!actorId) {
  console.error('Usage: deploy-apify.js <actorId>');
  process.exit(1);
}

if (!actorType) {
  console.error(
    'Usage: deploy-apify.js <actorId> <actorType=cheerio|puppeteer>'
  );
  process.exit(1);
}

if (actorType !== 'cheerio' && actorType !== 'puppeteer') {
  console.error('Invalid actor type. Must be "cheerio" or "puppeteer"');
  process.exit(1);
}

console.info(`Writing files for actor ${actorId}...`);

const dockerfileTemplate = fs.readFileSync(
  path.resolve(__dirname, `../docker/Dockerfile.${actorType}.template`),
  'utf8'
);

const dockerfile = dockerfileTemplate.replaceAll('{{actorId}}', actorId);

fs.writeFileSync(
  '.actor/actor.json',
  JSON.stringify(getActorSpec(actorId), null, 2)
);

fs.writeFileSync(
  '.actor/input.json',
  JSON.stringify(getActorInputSpec(actorId), null, 2)
);

fs.writeFileSync('.actor/Dockerfile', dockerfile);

const gitIgnoreContent = fs.readFileSync(
  path.resolve(__dirname, '../.gitignore'),
  'utf8'
);

const additionalGitIgnoreContent = [
  'packages/*',
  `!packages/shared/`,
  `!packages/${actorId}/`,
  '',
].join('\n');

if (!gitIgnoreContent.includes(additionalGitIgnoreContent)) {
  fs.writeFileSync(
    '.gitignore',
    [gitIgnoreContent, additionalGitIgnoreContent].join('\n')
  );
}

console.info('Deploying actor to Apify...');

if (dryRun) {
  console.info('Dry run complete. Exiting...');
  process.exit(0);
}

// run apify push, delete the files, and exit, handle errors and command+c

process.on('SIGINT', cleanup);
try {
  execSync('apify push', {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
} finally {
  cleanup();
}

function getActorSpec(actorId) {
  return {
    actorSpecification: 1,
    name: `${actorId}-scraper`,
    title: `${actorId} Scraper`,
    version: '0.0',
    input: './input.json',
    storages: {
      dataset: './output.json',
    },
  };
}

function getActorInputSpec() {
  return {
    title: `${actorId} scraper`,
    description: '',
    type: 'object',
    schemaVersion: 1,
    properties: {
      proxyConfiguration: {
        title: 'Proxy Configuration',
        type: 'object',
        description: 'Your proxy configuration from Apify',
        editor: 'proxy',
      },
      testLimit: {
        title: 'Number of URLs to Test',
        type: 'integer',
        description:
          'Optional: Enter the number of URLs to process for testing. If not provided, all URLs will be processed.',
        minimum: 1,
      },
    },
  };
}

function cleanup() {
  console.info('Cleaning up...');
  fs.unlinkSync('.actor/actor.json');
  fs.unlinkSync('.actor/input.json');
  fs.unlinkSync('.actor/Dockerfile');
  fs.writeFileSync('.gitignore', gitIgnoreContent);
}
