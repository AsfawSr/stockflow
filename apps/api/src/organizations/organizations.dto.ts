import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsISO4217CurrencyCode,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { OrganizationRole } from '../generated/prisma/client';

const organizationRoles: OrganizationRole[] = ['ADMIN', 'PURCHASER', 'MANAGER', 'WAREHOUSE'];

export class UpdateMemberRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(organizationRoles, { each: true })
  roles!: OrganizationRole[];
}

export class RenameOrganizationDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  name!: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  name?: string;

  // Null clears the address; IsOptional skips validation for both null and undefined.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  replyToEmail?: string | null;
}

export class CreateOrganizationDto extends RenameOrganizationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsISO4217CurrencyCode()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
