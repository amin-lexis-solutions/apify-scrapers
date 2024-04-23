import { Authorized, Get, JsonController } from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { StandardResponse } from '../utils/validators';

import { routingControllersToSpec } from 'routing-controllers-openapi';
import { getMetadataArgsStorage } from 'routing-controllers';

const storage = getMetadataArgsStorage();

@JsonController('/export')
export class ExportController {
  @Get('/open-api.json')
  @OpenAPI({
    summary: 'Export API spec',
    description:
      'Export the JSON reporesentation of the OpenAPI spec that you can import in Postman.',
  })
  @ResponseSchema(StandardResponse)
  @Authorized()
  @OpenAPI({ security: [{ bearerAuth: [] }] })
  async getTest(): Promise<StandardResponse> {
    return new StandardResponse(
      `You can import this JSON in Postman to test the API.`,
      false,
      routingControllersToSpec(storage)
    );
  }
}
