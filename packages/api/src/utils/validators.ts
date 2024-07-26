import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsIn,
  Max,
  Min,
  MinLength,
  Length,
  ValidateNested,
  IsUrl,
  IsFQDN,
  IsDateString,
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

const MAX_PAGE_SIZE = 10000;

export class ListRequestBody {
  @IsPositive()
  @IsOptional()
  page = 1;

  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  pageSize = 100;

  @IsBoolean()
  @IsOptional()
  show_disabled_merchants?: boolean;

  @IsBoolean()
  @IsOptional()
  archived?: boolean;

  @IsBoolean()
  @IsOptional()
  isExclusive?: boolean;

  @IsBoolean()
  @IsOptional()
  isExpired?: boolean;

  @IsBoolean()
  @IsOptional()
  isShown?: boolean;

  @IsBoolean()
  @IsOptional()
  shouldBeFake?: boolean;

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

  @IsString()
  @IsOptional()
  @IsIn(['code', 'offer', 'all'])
  type?: string;
}

export class CouponMatchRequestBody {
  @IsArray()
  ids: string[];
}

export class CouponIdsRequestBody {
  @IsArray()
  ids: string[];
}

export class FakeCouponsRequestBody {
  @IsArray()
  ids: string[];

  @IsBoolean()
  isFake: boolean;
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

  @IsDateString()
  startedAt: string;
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
  resultsPerPage?: number;

  @IsNumber()
  @IsOptional()
  maxPagesPerQuery?: number;

  @IsBoolean()
  @IsOptional()
  localeKeywords?: boolean;
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

export class TestWebhookRequestBody {
  @ValidateNested()
  @Type(() => EventData)
  eventData: EventData;

  @ValidateNested()
  @Type(() => Resource)
  resource: Resource;

  @IsString()
  @IsOptional()
  actorId: string;
}

export class ReliabilityRequestBody {
  @IsArray()
  @IsFQDN({ require_tld: true }, { each: true })
  domains: string[];
  @IsBoolean()
  isReliable: boolean;
}
