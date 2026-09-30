import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

const trimmedOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateTransferDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  fromLocationId!: string;

  @IsUUID()
  toLocationId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CreateAdjustmentDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  locationId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(-1000000)
  @Max(1000000)
  @NotEquals(0, { message: 'An adjustment must change the quantity.' })
  quantity!: number;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/, { message: 'Explain the reason for this adjustment.' })
  @MaxLength(500)
  reason!: string;
}

export class StockLevelsQueryDto {
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  low?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class StockMovementsQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
