import { Type } from 'class-transformer';
import { Reliability } from '@prisma/client';
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

  @IsOptional()
  @IsArray()
  errors?: string[];

  constructor(message: string, isError: boolean, data?: any, errors?: any[]) {
    this.status = isError ? 'ERROR' : 'SUCCESS';
    this.statusMessage = message;
    if (data) this.data = data;
    if (errors) this.errors = this.parseValidationErrors(errors);
  }
  private parseValidationErrors(errors?: any[] | string[]): string[] {
    if (!errors) return [];
    if (
      errors.every(
        (err) =>
          typeof err === 'object' && 'property' in err && 'constraints' in err
      )
    ) {
      return errors.map((err) => {
        if (err.constraints) {
          const message = Object.values(err.constraints)[0];
          return `${err.property} - ${message}`;
        }
        return `${err.property} - Invalid value`;
      });
    }

    return errors as string[];
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

  @IsArray()
  @IsOptional()
  isExclusive?: string[];

  @IsArray()
  @IsOptional()
  isExpired?: string[];

  @IsOptional()
  reliability?: Reliability | null;

  @IsBoolean()
  @IsOptional()
  isShown?: boolean;

  @IsArray()
  @IsOptional()
  shouldBeFake?: string[];

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

  @IsString({ message: 'sourceDomain must be a string' })
  @IsOptional()
  @MinLength(1, {
    message: 'sourceDomain cannot be empty when provided',
  })
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

  @IsNumber()
  @IsOptional()
  retriesCount?: number;
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
  locale: string;
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
  locale: string;

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

  @IsBoolean()
  @IsOptional()
  onlyUnScrapedMerchants?: boolean;
}

export class FindForMerchantPagesBody {
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

export class TestUrlsBody {
  @IsString()
  name: string;

  @IsNumber()
  @IsOptional()
  startUrlCount?: number;
}
