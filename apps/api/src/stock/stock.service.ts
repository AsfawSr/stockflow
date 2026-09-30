import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAdjustmentDto,
  CreateTransferDto,
  StockLevelsQueryDto,
  StockMovementsQueryDto,
} from './stock.dto';

const productSelect = { id: true, sku: true, name: true, unit: true, reorderPoint: true } as const;
const locationSelect = { id: true, name: true } as const;

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async levels(organizationId: string, query: StockLevelsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (query.low === 'true') return this.lowLevels(organizationId, query, page, pageSize);
    const where: Prisma.StockLevelWhereInput = {
      organizationId,
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.search
        ? {
            product: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { sku: { contains: query.search.toUpperCase() } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where,
        include: { product: { select: productSelect }, location: { select: locationSelect } },
        orderBy: [{ product: { name: 'asc' } }, { location: { name: 'asc' } }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockLevel.count({ where }),
    ]);
    return {
      items: items.map((level) => ({
        product: level.product,
        location: level.location,
        quantity: level.quantity,
        low: level.product.reorderPoint !== null && level.quantity <= level.product.reorderPoint,
        updatedAt: level.updatedAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  // Prisma cannot compare a column against a related column, so the low-stock report joins in SQL.
  private async lowLevels(
    organizationId: string,
    query: StockLevelsQueryDto,
    page: number,
    pageSize: number,
  ) {
    const search = query.search ? `%${query.search.replace(/[\\%_]/g, '\\$&')}%` : null;
    const locationId = query.locationId ?? null;
    const rows = await (this.prisma.$queryRaw`
      SELECT p.id AS product_id, p.sku, p.name AS product_name, p.unit,
             p.reorder_point, l.id AS location_id, l.name AS location_name,
             sl.quantity, sl.updated_at, (count(*) OVER ())::int AS total
      FROM stock_levels sl
      JOIN products p ON p.organization_id = sl.organization_id AND p.id = sl.product_id
      JOIN locations l ON l.organization_id = sl.organization_id AND l.id = sl.location_id
      WHERE sl.organization_id = ${organizationId}::uuid
        AND p.reorder_point IS NOT NULL
        AND sl.quantity <= p.reorder_point
        AND (${locationId}::uuid IS NULL OR sl.location_id = ${locationId}::uuid)
        AND (${search}::text IS NULL OR p.name ILIKE ${search} OR p.sku LIKE upper(${search}))
      ORDER BY p.name ASC, l.name ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    ` as Promise<
      {
        product_id: string;
        sku: string;
        product_name: string;
        unit: string;
        reorder_point: number;
        location_id: string;
        location_name: string;
        quantity: number;
        updated_at: Date;
        total: number;
      }[]
    >);
    return {
      items: rows.map((row) => ({
        product: {
          id: row.product_id,
          sku: row.sku,
          name: row.product_name,
          unit: row.unit,
          reorderPoint: row.reorder_point,
        },
        location: { id: row.location_id, name: row.location_name },
        quantity: row.quantity,
        low: true,
        updatedAt: row.updated_at,
      })),
      total: rows[0]?.total ?? 0,
      page,
      pageSize,
    };
  }

  async movements(organizationId: string, query: StockMovementsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.StockMovementWhereInput = {
      organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: productSelect },
          location: { select: locationSelect },
          createdBy: { select: { id: true, displayName: true } },
          receiptLine: {
            select: { receipt: { select: { purchaseOrder: { select: { number: true } } } } },
          },
          transfer: {
            select: {
              note: true,
              fromLocation: { select: { name: true } },
              toLocation: { select: { name: true } },
            },
          },
          adjustment: { select: { reason: true } },
        },
        // Type breaks the tie for a transfer pair created in the same instant.
        orderBy: [{ createdAt: 'desc' }, { type: 'asc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return {
      items: items.map((movement) => {
        let detail: string | null = null;
        if (movement.receiptLine) {
          detail = `Delivery for PO-${String(movement.receiptLine.receipt.purchaseOrder.number).padStart(4, '0')}`;
        } else if (movement.transfer) {
          detail = `${movement.transfer.fromLocation.name} to ${movement.transfer.toLocation.name}${
            movement.transfer.note ? ` - ${movement.transfer.note}` : ''
          }`;
        } else if (movement.adjustment) {
          detail = movement.adjustment.reason;
        }
        return {
          id: movement.id,
          type: movement.type,
          quantity: movement.quantity,
          product: movement.product,
          location: movement.location,
          createdBy: movement.createdBy,
          createdAt: movement.createdAt,
          detail,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  private async requireProduct(organizationId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { organizationId_id: { organizationId, id: productId } },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
  }

  private async requireLocation(organizationId: string, locationId: string, mustBeActive: boolean) {
    const location = await this.prisma.location.findUnique({
      where: { organizationId_id: { organizationId, id: locationId } },
      select: { archivedAt: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    if (mustBeActive && location.archivedAt)
      throw new ConflictException('The destination location is archived.');
  }

  // Locks existing balance rows for this product in a stable order to serialize writers.
  private lockLevels(
    tx: Prisma.TransactionClient,
    organizationId: string,
    productId: string,
    locationIds: string[],
  ) {
    return tx.$queryRaw`
      SELECT location_id, quantity FROM stock_levels
      WHERE organization_id = ${organizationId}::uuid
        AND product_id = ${productId}::uuid
        AND location_id = ANY(${locationIds}::uuid[])
      ORDER BY location_id
      FOR UPDATE
    ` as Promise<{ location_id: string; quantity: number }[]>;
  }

  async transfer(organizationId: string, userId: string, input: CreateTransferDto) {
    if (input.fromLocationId === input.toLocationId)
      throw new ConflictException('Choose two different locations.');
    await this.requireProduct(organizationId, input.productId);
    await this.requireLocation(organizationId, input.fromLocationId, false);
    await this.requireLocation(organizationId, input.toLocationId, true);

    const transferId = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockLevels(tx, organizationId, input.productId, [
        input.fromLocationId,
        input.toLocationId,
      ]);
      const available =
        locked.find((level) => level.location_id === input.fromLocationId)?.quantity ?? 0;
      if (available < input.quantity)
        throw new ConflictException(`Only ${available} available at the source location.`);
      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId,
          productId: input.productId,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          quantity: input.quantity,
          note: input.note ?? null,
          createdById: userId,
        },
        select: { id: true },
      });
      await tx.stockMovement.createMany({
        data: [
          {
            organizationId,
            productId: input.productId,
            locationId: input.fromLocationId,
            type: 'TRANSFER_OUT',
            quantity: -input.quantity,
            stockTransferId: transfer.id,
            createdById: userId,
          },
          {
            organizationId,
            productId: input.productId,
            locationId: input.toLocationId,
            type: 'TRANSFER_IN',
            quantity: input.quantity,
            stockTransferId: transfer.id,
            createdById: userId,
          },
        ],
      });
      await tx.stockLevel.update({
        where: {
          organizationId_productId_locationId: {
            organizationId,
            productId: input.productId,
            locationId: input.fromLocationId,
          },
        },
        data: { quantity: { decrement: input.quantity } },
      });
      await tx.stockLevel.upsert({
        where: {
          organizationId_productId_locationId: {
            organizationId,
            productId: input.productId,
            locationId: input.toLocationId,
          },
        },
        create: {
          organizationId,
          productId: input.productId,
          locationId: input.toLocationId,
          quantity: input.quantity,
        },
        update: { quantity: { increment: input.quantity } },
      });
      return transfer.id;
    });

    const levels = await this.prisma.stockLevel.findMany({
      where: {
        organizationId,
        productId: input.productId,
        locationId: { in: [input.fromLocationId, input.toLocationId] },
      },
      select: { locationId: true, quantity: true },
    });
    return { id: transferId, levels };
  }

  async adjust(organizationId: string, userId: string, input: CreateAdjustmentDto) {
    await this.requireProduct(organizationId, input.productId);
    await this.requireLocation(organizationId, input.locationId, false);

    const adjustmentId = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockLevels(tx, organizationId, input.productId, [input.locationId]);
      const available = locked[0]?.quantity ?? 0;
      if (input.quantity < 0 && available + input.quantity < 0)
        throw new ConflictException(`Only ${available} available to adjust down.`);
      const adjustment = await tx.stockAdjustment.create({
        data: {
          organizationId,
          productId: input.productId,
          locationId: input.locationId,
          quantity: input.quantity,
          reason: input.reason,
          createdById: userId,
        },
        select: { id: true },
      });
      await tx.stockMovement.create({
        data: {
          organizationId,
          productId: input.productId,
          locationId: input.locationId,
          type: 'ADJUSTMENT',
          quantity: input.quantity,
          stockAdjustmentId: adjustment.id,
          createdById: userId,
        },
      });
      // Upsert would CHECK the proposed negative insert row even on the update path.
      if (locked.length === 1) {
        await tx.stockLevel.update({
          where: {
            organizationId_productId_locationId: {
              organizationId,
              productId: input.productId,
              locationId: input.locationId,
            },
          },
          data: { quantity: { increment: input.quantity } },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            organizationId,
            productId: input.productId,
            locationId: input.locationId,
            quantity: input.quantity,
          },
        });
      }
      return adjustment.id;
    });

    const level = await this.prisma.stockLevel.findUnique({
      where: {
        organizationId_productId_locationId: {
          organizationId,
          productId: input.productId,
          locationId: input.locationId,
        },
      },
      select: { locationId: true, quantity: true },
    });
    return { id: adjustmentId, levels: level ? [level] : [] };
  }
}
