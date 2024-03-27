require('dotenv').config(); // This line should be at the very top of your main file

import 'reflect-metadata'; // Required for routing-controllers

import { validationMetadatasToSchemas } from 'class-validator-jsonschema';
import { Express } from 'express';
import expressBasicAuth from 'express-basic-auth';
import {
  RoutingControllersOptions,
  createExpressServer,
} from 'routing-controllers';
import { getMetadataArgsStorage } from 'routing-controllers';
import { routingControllersToSpec } from 'routing-controllers-openapi';
import swaggerUi from 'swagger-ui-express';

import { CouponsController } from './controllers/coupons-controller';
import { TargetsController } from './controllers/targets-controller';
import { WebhooksController } from './controllers/webhooks-controller';
import { SentryController } from './controllers/sentry-controller';
import { useNgrok } from './lib/ngrok';
import { CustomErrorHandler } from './middlewares/custom-error-handler';
import { authorizationChecker } from './utils/auth';

const routingControllersOptions: RoutingControllersOptions = {
  controllers: [
    WebhooksController,
    CouponsController,
    TargetsController,
    SentryController,
  ],
  middlewares: [
    CustomErrorHandler, // Registering your custom error handler
  ],
  defaultErrorHandler: false, // Disable the default error handler
  authorizationChecker,
};

const app: Express = createExpressServer(routingControllersOptions);

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

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);

  const args = process.argv.slice(2);
  if (args.includes('--ngrok')) {
    useNgrok(port);
  }
});
