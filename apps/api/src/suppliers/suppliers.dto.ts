import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimmedOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const emailOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;

export class CreateSupplierDto {
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  contactName?: string | null;

  @IsOptional()
  @Transform(emailOrNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @Matches(/^(?=.*[0-9])[+0-9()./ -]{3,32}$/, {
    message: 'Enter a phone number using digits and + ( ) . / - separators.',
  })
  phone?: string | null;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  address?: string | null;
}

export class UpdateSupplierDto extends CreateSupplierDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  declare name: string;
}

export class SetCatalogPriceDto {
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'Enter a price such as 25 or 25.50.' })
  unitPrice!: string;
}
