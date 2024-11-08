import dotenv from 'dotenv';
dotenv.config();
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import 'reflect-metadata'; // Required for routing-controllers

import compression from 'compression';
import express, { Express } from 'express';
import { useApitally } from 'apitally/express';
import { json } from 'body-parser';

import {
  RoutingControllersOptions,
  useExpressServer,
} from 'routing-controllers';
import { TargetsController } from './controllers/targets-controller';
import { WebhooksController } from './controllers/webhooks-controller';
import { SentryController } from './controllers/sentry-controller';
import { TestsController } from './controllers/tests-controller';

import { useNgrok } from './lib/ngrok';
import { CustomErrorHandler } from './middlewares/custom-error-handler';
import { authorizationChecker } from './utils/auth';

import { prisma } from './lib/prisma';
import { setupRedis } from './lib/redis';
import { healthCheck } from './middlewares/health-check';

// Create a single Express app instance
const app: Express = express();

if (process.env.APITALLY_CLIENT_ID)
  useApitally(app, {
    clientId: process.env.APITALLY_CLIENT_ID,
    env: process.env.NODE_ENV,
  });

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.SENTRY_LOGGING === 'true',
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

// Middleware
app.use(express.json());
app.use(healthCheck);
app.use(Sentry.Handlers.requestHandler());

// TracingHandler creates a trace for every incoming request
app.use(Sentry.Handlers.tracingHandler());

// Set the limit to 50MB
app.use(json({ limit: '5mb' }));

// Implement response compression to reduce payload size
app.use(compression());

const routingControllersOptions: RoutingControllersOptions = {
  controllers: [
    WebhooksController,
    TargetsController,
    SentryController,
    TestsController,
  ],
  middlewares: [
    CustomErrorHandler, // Registering your custom error handler
  ],
  defaultErrorHandler: false, // Disable the default error handler
  authorizationChecker,
};

// Initialize Redis
setupRedis().catch((error) => {
  console.error('Failed to connect to Redis:', error);
  process.exit(1);
});

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Apply the routing-controllers setup to the existing Express app
useExpressServer(app, routingControllersOptions);

// The error handler must be before any other error middleware and after all controllers
app.use(Sentry.Handlers.errorHandler());

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Pipeline service running on port ${port}`);

  const args = process.argv.slice(2);
  if (args.includes('--ngrok')) {
    useNgrok(port);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});
