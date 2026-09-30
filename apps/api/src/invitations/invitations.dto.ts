import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { OrganizationRole } from '../generated/prisma/client';

const organizationRoles: OrganizationRole[] = ['ADMIN', 'PURCHASER', 'MANAGER', 'WAREHOUSE'];

export class CreateInvitationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(organizationRoles, { each: true })
  roles!: OrganizationRole[];
}

export class AcceptInvitationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}
