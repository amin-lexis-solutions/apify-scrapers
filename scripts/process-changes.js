// File: scripts/process-changes.js
const fs = require('fs');
const changedFiles = JSON.parse(process.argv[2]);
let rebuildAll = false;
const actors = new Set();

changedFiles.forEach(file => {
  if (file.startsWith('packages/shared')) {
    rebuildAll = true;
  } else {
    const match = file.match(/^packages\/(.*?)\//);
    if (match && match[1] !== 'api' && match[1] !== 'shared') {
      actors.add(match[1]);
    }
  }
});

// This will either be all actors if rebuildAll is true, or the specific changed ones.
const matrixValue = rebuildAll ? 'all' : [...actors].join(',');

// Write the output for later steps
fs.writeFileSync(process.env.GITHUB_ENV, `ACTOR_MATRIX=${matrixValue}\n`);
