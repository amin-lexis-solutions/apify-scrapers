import { PrismaClient } from '@prisma/client';
import {
  Authorized,
  BadRequestError,
  JsonController,
  Param,
  Post,
} from 'routing-controllers';
import { OpenAPI, ResponseSchema } from 'routing-controllers-openapi';

import { StandardResponse } from '../utils/validators';

const prisma = new PrismaClient();

@JsonController()
@Authorized()
@OpenAPI({ security: [{ token: [] }] })
export class ArchiveController {
  @Post('/archive/:id')
  @OpenAPI({
    summary: 'Archive a record',
    description: 'Archive a record by ID',
  })
  @ResponseSchema(StandardResponse) // Apply @ResponseSchema at the method level
  async archive(@Param('id') id: string): Promise<StandardResponse> {
    if (!id || id.trim() === '') {
      throw new BadRequestError(
        'ID parameter is required and cannot be empty.'
      );
    }

    const existingRecord = await prisma.coupon.findUnique({
      where: { id },
    });

    if (!existingRecord) {
      throw new BadRequestError('Record not found.');
    }

    if (existingRecord.archivedAt) {
      const archivedDate = existingRecord.archivedAt.toISOString();

      return new StandardResponse(
        `Record already archived on ${archivedDate}. No changes done.`,
        false,
        { existingRecord: existingRecord }
      );
    }

    const updatedRecord = await prisma.coupon.update({
      where: { id },
      data: { archivedAt: new Date(), archivedReason: 'manual' },
    });

    return new StandardResponse('Record archived successfully', false, {
      updatedRecord: updatedRecord,
    });
  }
}
