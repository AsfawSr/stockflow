import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trimmedOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId!: string;

  @IsUUID()
  locationId!: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class OrderLineDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;

  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Enter a price such as 25 or 25.50.' })
  unitPrice!: string;
}

export class UpdateOrderLineDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity?: number;

  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Enter a price such as 25 or 25.50.' })
  unitPrice?: string;
}

export class DecisionDto {
  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class RejectDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/, { message: 'Explain why the order is rejected.' })
  @MaxLength(1000)
  note!: string;
}

export class ReceiptLineDto {
  @IsUUID()
  purchaseOrderLineId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;
}

export class CreateReceiptDto {
  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineDto)
  lines!: ReceiptLineDto[];
}

export class ListPurchaseOrdersDto {
  @IsOptional()
  @IsIn([...PURCHASE_ORDER_STATUSES, 'all'])
  status?: (typeof PURCHASE_ORDER_STATUSES)[number] | 'all';

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
