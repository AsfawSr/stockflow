import { Transform } from 'class-transformer';
import { IsISO4217CurrencyCode, IsString, Matches, MaxLength } from 'class-validator';

export class RenameOrganizationDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  name!: string;
}

export class CreateOrganizationDto extends RenameOrganizationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsISO4217CurrencyCode()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
