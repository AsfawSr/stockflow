import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimmedOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreateLocationDto {
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  address?: string | null;
}

export class UpdateLocationDto extends CreateLocationDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  declare name: string;
}
