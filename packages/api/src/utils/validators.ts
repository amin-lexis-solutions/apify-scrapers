import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class StandardResponse {
  @IsString()
  status: string;

  @IsString()
  statusMessage: string;

  @IsOptional()
  @IsObject()
  data?: any;

  constructor(message: string, isError: boolean, data?: any) {
    this.status = isError ? 'ERROR' : 'SUCCESS';
    this.statusMessage = message;
    if (data) {
      this.data = data;
    }
  }
}

export class ArchiveRequestBody {
  @IsString()
  id: string;
}

const MAX_PAGE_SIZE = 100;

export class ListRequestBody {
  @IsPositive()
  @IsOptional()
  page = 1;

  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  pageSize = 10;

  @IsString()
  @IsOptional()
  locale?: string;

  @IsBoolean()
  @IsOptional()
  archived?: string;

  @IsString()
  @IsOptional()
  domain?: string;
}

export class EventData {
  @IsString()
  actorId: string;

  @IsString()
  actorRunId: string;
}

export class Resource {
  @IsString()
  defaultDatasetId: string;

  @IsString()
  status: string;
}

export class WebhookRequestBody {
  @ValidateNested()
  @Type(() => EventData)
  eventData: EventData;

  @ValidateNested()
  @Type(() => Resource)
  resource: Resource;
}
