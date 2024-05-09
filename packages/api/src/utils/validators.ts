import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
  Length,
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

const MAX_PAGE_SIZE = 100;

export class ListRequestBody {
  @IsPositive()
  @IsOptional()
  page = 1;

  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  pageSize = 10;

  @IsBoolean()
  @IsOptional()
  archived?: boolean;

  @IsString()
  @IsOptional()
  @MinLength(1)
  merchantDomain?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  merchantName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  sourceName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  sourceDomain?: string;

  @IsString()
  @IsOptional()
  @Length(5)
  locale?: string;
}

export class CouponMatchRequestBody {
  @IsArray()
  ids: string[];
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

  @IsString()
  @IsOptional()
  sourceId?: string;

  @IsString()
  localeId: string;

  @IsString()
  targetIds?: string;
}

export class SerpWebhookRequestBody {
  @ValidateNested()
  @Type(() => EventData)
  eventData: EventData;

  @ValidateNested()
  @Type(() => Resource)
  resource: Resource;

  @IsString()
  @IsOptional()
  sourceId?: string;

  @IsString()
  localeId: string;
}

export class FindTargetPagesBody {
  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsString()
  @IsOptional()
  locale?: string;
}

export class RunNLocalesBody {
  @IsNumber()
  localesCount: number;

  @IsNumber()
  @IsOptional()
  limitDomainsPerLocale?: number;
}

export class RunTargetPagesBody {
  @IsNumber()
  maxConcurrency: number;
}
export class ListTestRequestBody {
  @IsPositive()
  @IsOptional()
  page = 1;

  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  pageSize = 10;

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  actorId?: string;

}
export class TestActor {
  @IsString()
  actorId: string;
  @IsString()
  testName: string;
  @IsString()
  startUrls: string[];
}

export class RunTestBody {
  @IsArray()
  actors: TestActor[]
  maxConcurrency: number
}
export class TestRequestBody {
  status: string
  apifyRunId: string
  lastApifyRunAt: Date
}