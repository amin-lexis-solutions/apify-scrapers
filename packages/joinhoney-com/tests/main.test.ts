import fs from 'fs';
import path from 'path';

// Define the path to the routes.ts file
const filePath = path.resolve(__dirname, '../src/routes.ts');

// Define the functions to check for
const functionsToCheck = ['preProcess', 'processCouponItem', 'postProcess'];
const handlerToCheck = [
  'AnomalyCheckHandler',
  'SaveDataHandler',
  'IndexPageHandler',
];

// Read the routes.ts file
const fileContent = fs.readFileSync(filePath, 'utf-8');

// Function to check if a function is called within another function
const isFunctionCalled = (
  fileContent: string,
  functionName: string
): boolean => {
  const regex = new RegExp(`\\b${functionName}\\b\\s*\\(`, 'g');
  return regex.test(fileContent);
};

// Function to check if a handler is called within hooks functions
const isHandlerCalled = (fileContent: string, handlerName: string): boolean => {
  const regex = new RegExp(`\\b${handlerName}\\b\\s*\\:`, 'g');
  return regex.test(fileContent);
};

// Jest test suite
describe('Function Implementation Tests', () => {
  functionsToCheck.forEach((functionName) => {
    it(`should have implemented ${functionName}`, () => {
      const result = isFunctionCalled(fileContent, functionName);
      expect(result).toBe(true);
    });
  });
});

describe('Handler Implementation Tests', () => {
  handlerToCheck.forEach((handlerName) => {
    it(`should have implemented ${handlerName}`, () => {
      const result = isHandlerCalled(fileContent, handlerName);
      expect(result).toBe(true);
    });
  });
});
