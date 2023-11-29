require('dotenv').config(); // This line should be at the very top of your main file

import 'reflect-metadata'; // Required for routing-controllers

import { validationMetadatasToSchemas } from 'class-validator-jsonschema';
import { Express } from 'express';
import {
  RoutingControllersOptions,
  createExpressServer,
} from 'routing-controllers';
import { getMetadataArgsStorage } from 'routing-controllers';
import { routingControllersToSpec } from 'routing-controllers-openapi';
import swaggerUi from 'swagger-ui-express';

import { ArchiveController } from './controllers/archive-controller'; // Import the ArchiveController
import { ListController } from './controllers/list-controller'; // Import the ListController
import { WebhookController } from './controllers/webhook-controller'; // Import the WebhookController
import { CustomErrorHandler } from './middlewares/custom-error-handler'; // Import your custom error handler

const routingControllersOptions: RoutingControllersOptions = {
  controllers: [
    WebhookController, // Registering the WebhookController
    ListController, // Registering the ListController
    ArchiveController, // Registering the ArchiveController
  ],
  middlewares: [
    CustomErrorHandler, // Registering your custom error handler
  ],
  defaultErrorHandler: false, // Disable the default error handler
};

const app: Express = createExpressServer(routingControllersOptions);

// Generate OpenAPI spec
const storage = getMetadataArgsStorage();

const schemas = validationMetadatasToSchemas({
  refPointerPrefix: '#/components/schemas/',
});

const spec = routingControllersToSpec(storage, routingControllersOptions, {
  components: { schemas: schemas as any },
  info: {
    title: 'Oberst Coupon API',
    version: '1.0.0',
    description: 'API Documentation',
  },
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
