#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

// Script to check if every folder in packages/ has a corresponding .ts config file in packages/api/config/actors/
// with the same name as the package name. Excludes packages/api and packages/shared.

const baseDir = path.resolve(__dirname, '..');
const packagesDir = path.join(baseDir, 'packages');
const actorsConfigDir = path.join(baseDir, 'packages/api/config/actors');

const checkConfigForPackages = async () => {
  try {
    const packageDirs = await fs.readdir(packagesDir, { withFileTypes: true });
    const actorConfigs = await fs.readdir(actorsConfigDir);

    const missingConfigs = packageDirs
      .filter(
        (dirent) =>
          dirent.isDirectory() &&
          !['api', 'shared', 'test'].includes(dirent.name)
      )
      .map((dirent) => dirent.name)
      .filter((packageName) => !actorConfigs.includes(`${packageName}.ts`));

    if (missingConfigs.length > 0) {
      console.error('Missing config files for the following packages:');
      console.table(missingConfigs);
      process.exit(1);
    }
    console.log('All packages have corresponding config files.');
  } catch (error) {
    console.error('Error checking package configs:', error.message);
    process.exit(1);
  }
};

checkConfigForPackages();
