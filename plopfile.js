module.exports = function (plop) {
  plop.setGenerator('boilerplate', {
    description: 'Generate a boilerplate for Puppeteer or Cheerio actors',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'What is your actor name?',
        validate: function (value) {
          const validName = /^[a-zA-Z0-9-_]+$/.test(value);
          if (value && validName) {
            return true;
          }
          return 'Name is required and should only contain letters, numbers, dashes, and underscores';
        },
      },
      {
        type: 'list',
        name: 'library',
        message: 'Which library would you like to use?',
        choices: ['Puppeteer', 'Cheerio'],
      },
    ],
    actions: function (data) {
      const basePath = `./packages/${data.name}/`;

      // Check if the directory already exists
      const fs = require('fs');
      if (fs.existsSync(basePath)) {
        throw new Error(`Project with name ${data.name} already exists`);
      }

      // Define actions for creating the project structure
      const actions = [
        {
          type: 'add',
          path: `${basePath}src/main.ts`,
          templateFile:
            data.library === 'Puppeteer'
              ? 'templates/puppeteer/main.ts.hbs'
              : 'templates/cheerio/main.ts.hbs',
        },
        {
          type: 'add',
          path: `${basePath}src/routes.ts`,
          templateFile:
            data.library === 'Puppeteer'
              ? 'templates/puppeteer/routes.ts.hbs'
              : 'templates/cheerio/routes.ts.hbs',
        },
        {
          type: 'add',
          path: `${basePath}tsconfig.json`,
          templateFile: 'templates/tsconfig.json.hbs',
        },
        {
          type: 'add',
          path: `${basePath}README.md`,
          templateFile: 'templates/README.md.hbs',
        },
        {
          type: 'add',
          path: `${basePath}jest.config.js`,
          templateFile: 'templates/jest.config.js.hbs',
        },
        {
          type: 'add',
          path: `${basePath}package.json`,
          templateFile: 'templates/package.json.hbs',
        },
        {
          type: 'modify',
          path: `${basePath}package.json`,
          transform: (fileContent) => {
            const content = JSON.parse(fileContent);
            content.name = data.name;
            content.description = `An actor for ${data.library}`;
            content.author = 'Lexis Solutions';
            content.scripts = {
              ...content.scripts,
              'start:prod': `node dist/${data.name}/src/main.js`,
            };

            // Add dependencies based on the selected library
            if (data.library === 'Puppeteer') {
              content.dependencies = {
                ...content.dependencies,
                '@types/puppeteer': '^7.0.4',
                puppeteer: '*',
              };
            } else {
              content.dependencies = {
                ...content.dependencies,
                '@types/cheerio': '^0.22.34',
                cheerio: '^1.0.0-rc.10',
              };
            }

            return JSON.stringify(content, null, 2);
          },
        },
      ];

      return actions;
    },
  });
};
