import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the current module's file path
const __filename = fileURLToPath(import.meta.url);

// Get the directory of the current module's file
const __dirname = dirname(__filename);

const filePath = join(__dirname, '/specs/dynamicTemplate.spec.js');

export const Template = readFileSync(filePath, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading file:', err);
    return;
  }
  // Print the contents of the file as a string
  return data;
});
