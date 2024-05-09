import * as fs from 'fs';
import * as path from 'path'; 

// Get the current file path
const filePath = path.join(__dirname, '/specs/dynamicTemplate.spec.ts');

export const Template: string = fs.readFileSync(filePath, 'utf8'); // utf-8 encoding for text files

