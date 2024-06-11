### Setting Up a Backend API Integration Guide

This guide walks through the setup of a TypeScript-based API using Express.js and Prisma, designed to integrate with Apify for automated web scraping and PostgreSQL for data storage.

#### Prerequisites
- **Node.js** installed (version 14.x or higher recommended)
- **PostgreSQL** database setup
- **Yarn** or **npm** for package management

#### Initial Setup
1. **Clone the Repository:**
   ```bash
   git clone https://github.com/lexis-solutions/oberst-scrapers.git
   cd oberst-scrapers
   ```

2. **Install Dependencies:**
   ```bash
   yarn install
   ```
   or
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   Create a `.env` file in the root directory and populate it with necessary environment variables:
   ```plaintext
   DATABASE_URL="postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE"
   APIFY_API_KEY="your_apify_key_here"
   SENTRY_DSN="your_sentry_dsn_here"
   ```

#### Database Setup with Prisma
1. **Configure Prisma:**
   - Your Prisma schema file (`prisma/schema.prisma`) should be set up to reflect your database configurations.

2. **Run Migrations:**
   Initialize your database schema:
   ```bash
   yarn prisma:migrate
   ```
   or
   ```bash
   npm run prisma:migrate
   ```

3. **Seed the Database:**
   Populate your database with initial data if necessary:
   ```bash
   yarn prisma:seed
   ```
   or
   ```bash
   npm run prisma:seed
   ```

#### Running the API Server
1. **Start the Development Server:**
   ```bash
   yarn dev
   ```
   or
   ```bash
   npm run dev
   ```
   This command uses nodemon to run `src/server.ts`, watching for any changes.

2. **Build the Application:**
   For a production build, compile the TypeScript files:
   ```bash
   yarn build
   ```
   or
   ```bash
   npm run build
   ```

3. **Start the Production Server:**
   After building, start your application:
   ```bash
   yarn start
   ```
   or
   ```bash
   npm start
   ```

#### Additional Commands
- **Prisma Studio:**
  Access a visual interface for your database:
  ```bash
  yarn prisma:studio
  ```
  or
  ```bash
  npm run prisma:studio
  ```

- **Schedule Jobs:**
  For scheduling specific actors or tasks:
  ```bash
  yarn schedule:actors
  yarn schedule:find-serp
  ```

#### Troubleshooting
- Ensure all environment variables are set correctly.
- Check the PostgreSQL connection details.
- Run `yarn prisma:generate` to ensure Prisma Client is up-to-date.

#### Links and Resources
- **[Prisma Documentation](https://www.prisma.io/docs/)**
- **[Express.js Guide](https://expressjs.com/en/starter/installing.html)**
- **[TypeScript Documentation](https://www.typescriptlang.org/docs/)**

This setup provides a robust foundation for integrating web scraping capabilities into your application, allowing efficient data retrieval and management through well-documented API endpoints.