import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';
import { ListQueryDto } from '../common/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './suppliers.dto';

const supplierSelect = {
  id: true,
  name: true,
  contactName: true,
  email: true,
  phone: true,
  address: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private duplicateName(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('This supplier name is already used in this organization.');
    }
  }

  async list(organizationId: string, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'active';
    const where: Prisma.SupplierWhereInput = {
      organizationId,
      ...(status === 'active' ? { archivedAt: null } : {}),
      ...(status === 'archived' ? { archivedAt: { not: null } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        select: supplierSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(organizationId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { organizationId_id: { organizationId, id: supplierId } },
      select: supplierSelect,
    });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    return supplier;
  }

  // Quoted prices maintained by hand, independent of order history.
  async catalog(organizationId: string, supplierId: string) {
    await this.get(organizationId, supplierId);
    const entries = await this.prisma.supplierCatalogPrice.findMany({
      where: { organizationId, supplierId },
      select: {
        id: true,
        unitPrice: true,
        updatedAt: true,
        product: { select: { id: true, sku: true, name: true, unit: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
    });
    return {
      items: entries.map((entry) => ({
        id: entry.id,
        product: entry.product,
        unitPrice: entry.unitPrice.toFixed(2),
        updatedAt: entry.updatedAt,
      })),
    };
  }

  async setCatalogPrice(
    actorId: string,
    organizationId: string,
    supplierId: string,
    productId: string,
    unitPrice: string,
  ) {
    const supplier = await this.get(organizationId, supplierId);
    const product = await this.prisma.product.findUnique({
      where: { organizationId_id: { organizationId, id: productId } },
      select: { name: true, archivedAt: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (product.archivedAt) {
      throw new ConflictException('Archived products cannot be quoted.');
    }
    const price = new Prisma.Decimal(unitPrice);
    if (price.lessThanOrEqualTo(0)) throw new BadRequestException('Enter a price above zero.');
    const entry = await this.prisma.supplierCatalogPrice.upsert({
      where: { supplierId_productId: { supplierId, productId } },
      create: { organizationId, supplierId, productId, unitPrice: price },
      update: { unitPrice: price },
      select: {
        id: true,
        unitPrice: true,
        updatedAt: true,
        product: { select: { id: true, sku: true, name: true, unit: true } },
      },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'supplier.price_set',
      entityType: 'supplier',
      entityId: supplierId,
      summary: `Quoted ${product.name} at ${price.toFixed(2)} for ${supplier.name}`,
    });
    return {
      id: entry.id,
      product: entry.product,
      unitPrice: entry.unitPrice.toFixed(2),
      updatedAt: entry.updatedAt,
    };
  }

  async removeCatalogPrice(
    actorId: string,
    organizationId: string,
    supplierId: string,
    productId: string,
  ) {
    const supplier = await this.get(organizationId, supplierId);
    const entry = await this.prisma.supplierCatalogPrice.findFirst({
      where: { organizationId, supplierId, productId },
      select: { id: true, product: { select: { name: true } } },
    });
    if (!entry) throw new NotFoundException('This product is not in the catalog.');
    await this.prisma.supplierCatalogPrice.deleteMany({ where: { id: entry.id } });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'supplier.price_removed',
      entityType: 'supplier',
      entityId: supplierId,
      summary: `Removed the ${entry.product.name} quote for ${supplier.name}`,
    });
  }

  // Latest confirmed unit price per product, derived from approved order history.
  async prices(organizationId: string, supplierId: string) {
    await this.get(organizationId, supplierId);
    const rows = (await this.prisma.$queryRaw`
      SELECT DISTINCT ON (l.product_id)
        p.id AS product_id, p.sku, p.name, p.unit,
        l.unit_price, o.number, o.decided_at
      FROM purchase_order_lines l
      JOIN purchase_orders o ON o.id = l.purchase_order_id
      JOIN products p ON p.organization_id = l.organization_id AND p.id = l.product_id
      WHERE o.organization_id = ${organizationId}::uuid
        AND o.supplier_id = ${supplierId}::uuid
        AND o.status::text IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
      ORDER BY l.product_id, o.decided_at DESC, l.id DESC
    `) as {
      product_id: string;
      sku: string;
      name: string;
      unit: string;
      unit_price: string;
      number: number;
      decided_at: Date;
    }[];
    return {
      items: rows
        .map((row) => ({
          product: { id: row.product_id, sku: row.sku, name: row.name, unit: row.unit },
          unitPrice: new Prisma.Decimal(row.unit_price).toFixed(2),
          reference: `PO-${String(row.number).padStart(4, '0')}`,
          decidedAt: row.decided_at,
        }))
        .sort((left, right) => left.product.name.localeCompare(right.product.name)),
    };
  }

  // Delivery reliability over confirmed orders; lead time measures approval to last receipt.
  async performance(organizationId: string, supplierId: string) {
    await this.get(organizationId, supplierId);
    const [row] = (await this.prisma.$queryRaw`
      WITH confirmed AS (
        SELECT o.id, o.status, o.decided_at,
          (SELECT MAX(g.created_at) FROM goods_receipts g WHERE g.purchase_order_id = o.id)
            AS last_receipt_at,
          (SELECT COALESCE(SUM(l.quantity), 0) FROM purchase_order_lines l
            WHERE l.purchase_order_id = o.id) AS ordered,
          (SELECT COALESCE(SUM(l.received_quantity), 0) FROM purchase_order_lines l
            WHERE l.purchase_order_id = o.id) AS received
        FROM purchase_orders o
        WHERE o.organization_id = ${organizationId}::uuid
          AND o.supplier_id = ${supplierId}::uuid
          AND o.status::text IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
      )
      SELECT COUNT(*)::int AS confirmed_orders,
        (COUNT(*) FILTER (WHERE status::text IN ('APPROVED', 'PARTIALLY_RECEIVED')))::int
          AS open_orders,
        COALESCE(SUM(ordered), 0)::int AS ordered_units,
        COALESCE(SUM(received), 0)::int AS received_units,
        AVG(EXTRACT(EPOCH FROM (last_receipt_at - decided_at)) / 86400)
          FILTER (WHERE status::text = 'RECEIVED') AS average_lead_days
      FROM confirmed
    `) as {
      confirmed_orders: number;
      open_orders: number;
      ordered_units: number;
      received_units: number;
      average_lead_days: string | null;
    }[];
    return {
      confirmedOrders: row.confirmed_orders,
      openOrders: row.open_orders,
      orderedUnits: row.ordered_units,
      receivedUnits: row.received_units,
      fillRatePercent:
        row.ordered_units > 0
          ? new Prisma.Decimal(row.received_units).div(row.ordered_units).mul(100).toFixed(1)
          : null,
      averageLeadDays:
        row.average_lead_days !== null
          ? new Prisma.Decimal(row.average_lead_days).toFixed(1)
          : null,
    };
  }

  async create(organizationId: string, input: CreateSupplierDto) {
    try {
      return await this.prisma.supplier.create({
        data: {
          organizationId,
          name: input.name,
          contactName: input.contactName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
        },
        select: supplierSelect,
      });
    } catch (error) {
      this.duplicateName(error);
      throw error;
    }
  }

  async update(organizationId: string, supplierId: string, input: UpdateSupplierDto) {
    try {
      const updated = await this.prisma.supplier.updateMany({
        where: { id: supplierId, organizationId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
        },
      });
      if (updated.count !== 1) throw new NotFoundException('Supplier not found.');
    } catch (error) {
      this.duplicateName(error);
      throw error;
    }
    return this.get(organizationId, supplierId);
  }

  async setArchived(organizationId: string, supplierId: string, archived: boolean) {
    const updated = await this.prisma.supplier.updateMany({
      where: { id: supplierId, organizationId, archivedAt: archived ? null : { not: null } },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.supplier.findUnique({
        where: { organizationId_id: { organizationId, id: supplierId } },
        select: { archivedAt: true },
      });
      if (!exists) throw new NotFoundException('Supplier not found.');
      throw new ConflictException(
        archived ? 'This supplier is already archived.' : 'This supplier is not archived.',
      );
    }
    return this.get(organizationId, supplierId);
  }
}
