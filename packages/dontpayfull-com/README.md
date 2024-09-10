# Apify Actor Setup

This project sets up an Apify actor using either Puppeteer or Cheerio. Follow the instructions below to configure your environment and start the actor.

## Prerequisites

Ensure you have the following installed on your system:
- [Node.js](https://nodejs.org/en/)
- [Yarn](https://yarnpkg.com/) or [npm](https://www.npmjs.com/)

## Setup

1. **Install Dependencies**

   Install the required dependencies by running:

   ```sh
   yarn install
   ```

   or

   ```sh
   npm install
   ```

2. **Environment Variables**

   Set up the required environment variables:
   
   - `BASE_URL`: The base URL for your actor.
   - `APIFY_TOKEN`: Your Apify API token.

   You can set these variables in your terminal session or in a `.env` file at the root of your project.

   Example `.env` file:
   ```env
   BASE_URL=https://example.com
   APIFY_TOKEN=your_apify_token
   ```

   Alternatively, you can export the variables in your terminal session:

   ```sh
   export BASE_URL=https://example.com
   export APIFY_TOKEN=your_apify_token
   ```

3. **Add INPUT.json**

   Create an `INPUT.json` file in `./storage/key_value_stores/default` with the following content:

   ```json
   {
       "proxyConfiguration": {
           "useApifyProxy": false,
           "useApifyProxyRotation": false
       },
       "startUrls": [
           {
               "url": "https://example.com", 
                   "locale": "en_US",
                   "targetPageId": "test_id",
                   "localeId": "test_id"
               }
           }
       ]
   }
   ```

   Make sure to replace `https://example.com` with the correct domain you intend to scrape.

4. **Start the Actor**

   Run the actor using the following command:

   ```sh
   yarn start
   ```

   or

   ```sh
   npm start
   ```

## Project Structure

The project is structured as follows:

- `src/`: Contains the source code for the actor.
- `storage/`: Contains the storage for Apify key-value stores.
- `tsconfig.json`: TypeScript configuration file.
- `jest.config.js`: Jest configuration file for testing.
- `package.json`: Project metadata and dependencies.

## Development

To build the project, use:

```sh
yarn build
```

or

```sh
npm run build
```

To run tests, use:

```sh
yarn test
```

or

```sh
npm test
```

## Contributing

If you would like to contribute, please fork the repository and use a feature branch. Pull requests are warmly welcome.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.