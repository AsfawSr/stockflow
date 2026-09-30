import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const canonicalSku = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
// Empty descriptions are stored as null, never as blank strings.
const trimmedOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateProductDto {
  @Transform(canonicalSku)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9._-]*$/, {
    message: 'SKU must use letters, digits, dots, underscores, or hyphens.',
  })
  @MaxLength(64)
  sku!: string;

  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  name!: string;

  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(32)
  unit!: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateProductDto {
  @IsOptional()
  @Transform(canonicalSku)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9._-]*$/, {
    message: 'SKU must use letters, digits, dots, underscores, or hyphens.',
  })
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(32)
  unit?: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class ListProductsDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';

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
