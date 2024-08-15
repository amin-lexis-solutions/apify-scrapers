import dotenv from 'dotenv';
dotenv.config();
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import 'reflect-metadata'; // Required for routing-controllers

import { validationMetadatasToSchemas } from 'class-validator-jsonschema';

import express, { Express } from 'express';
import { json } from 'body-parser';

import expressBasicAuth from 'express-basic-auth';
import {
  RoutingControllersOptions,
  useExpressServer,
} from 'routing-controllers';
import { getMetadataArgsStorage } from 'routing-controllers';
import { routingControllersToSpec } from 'routing-controllers-openapi';
import swaggerUi from 'swagger-ui-express';

import { CouponsController } from './controllers/coupons-controller';
import { ExportsController } from './controllers/exports-controller';
import { TargetsController } from './controllers/targets-controller';
import { WebhooksController } from './controllers/webhooks-controller';
import { SentryController } from './controllers/sentry-controller';
import { useNgrok } from './lib/ngrok';
import { CustomErrorHandler } from './middlewares/custom-error-handler';
import { authorizationChecker } from './utils/auth';
import { TestsController } from './controllers/tests-controller';

// Create a single Express app instance
const app: Express = express();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    // enable HTTP calls tracing
    new Sentry.Integrations.Http({ tracing: true }),
    // enable Express.js middleware tracing
    new Sentry.Integrations.Express({ app }),
    nodeProfilingIntegration(),
  ],
  // Performance Monitoring
  tracesSampleRate: 0.5, // Adjusted from 1 to 0.5 to reduce the amount of data sent
  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: 0.2, // Reduce profiling rate to decrease performance impact
});

// The request handler must be the first middleware on the app
app.use(Sentry.Handlers.requestHandler());

// TracingHandler creates a trace for every incoming request
app.use(Sentry.Handlers.tracingHandler());

// Set the limit to 50MB
app.use(json({ limit: '5mb' }));

const routingControllersOptions: RoutingControllersOptions = {
  controllers: [
    WebhooksController,
    CouponsController,
    TargetsController,
    SentryController,
    ExportsController,
    TestsController,
  ],
  middlewares: [
    CustomErrorHandler, // Registering your custom error handler
  ],
  defaultErrorHandler: false, // Disable the default error handler
  authorizationChecker,
};

// Apply the routing-controllers setup to the existing Express app
useExpressServer(app, routingControllersOptions);

// Generate OpenAPI spec
const storage = getMetadataArgsStorage();

const schemas = validationMetadatasToSchemas({
  refPointerPrefix: '#/components/schemas/',
});

const spec = routingControllersToSpec(storage, routingControllersOptions, {
  components: {
    schemas: schemas as any,
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        // If your token does not adhere to a specific format like JWT, you can omit the bearerFormat field
        // Or provide a general description if there's a specific format or guideline you follow
        // bearerFormat: 'YourCustomFormat', // Optional, describe your token format if needed
      },
    },
  },
  info: {
    title: 'Coupon API',
    version: '1.0.0',
    description:
      'Routes marked as authenticated require a valid API key in the "Authorization" header.',
  },
});

app.use(
  '/api-docs',
  expressBasicAuth({
    users: { admin: process.env.API_DOCS_PASSWORD || '' },
    challenge: true,
  }),
  swaggerUi.serve,
  swaggerUi.setup(spec)
);

// The error handler must be before any other error middleware and after all controllers
app.use(Sentry.Handlers.errorHandler());

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);

  const args = process.argv.slice(2);
  if (args.includes('--ngrok')) {
    useNgrok(port);
  }
});
