import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const trimmedOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class OpenCycleCountDto {
  @IsUUID()
  locationId!: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  note?: string | null;
}

export class RecordCountDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  countedQuantity!: number;
}
