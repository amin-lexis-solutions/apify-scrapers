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
  IsUrl,
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

  @IsNumber()
  usageTotalUsd: number;
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

  @IsBoolean()
  @IsOptional()
  removeDuplicates: boolean;
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

export class TargetLocaleBody {
  @IsString()
  locale: string;

  @IsArray()
  urls: string[];

  @IsNumber()
  @IsOptional()
  limit?: number;
}

export class AnomalyRequestBody {
  @IsUrl()
  sourceUrl: string;

  @IsNumber()
  couponsCount: number;
}
export class RunTestBody {
  @IsNumber()
  maxConcurrency: number;
}
