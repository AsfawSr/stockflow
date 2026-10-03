import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePurchaseOrderDto,
  CreateReceiptDto,
  ListPurchaseOrdersDto,
  OrderLineDto,
  UpdateOrderLineDto,
  UpdatePurchaseOrderDto,
} from './purchase-orders.dto';

const lineInclude = {
  product: { select: { id: true, sku: true, name: true, unit: true } },
} as const;

const detailInclude = {
  supplier: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  decidedBy: { select: { id: true, displayName: true } },
  lines: { include: lineInclude, orderBy: { id: 'asc' as const } },
  receipts: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      receivedBy: { select: { id: true, displayName: true } },
      lines: { include: { orderLine: { include: lineInclude } }, orderBy: { id: 'asc' as const } },
    },
  },
} as const;

type OrderDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof detailInclude }>;

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function mapLine(line: OrderDetail['lines'][number]) {
  return {
    id: line.id,
    product: line.product,
    quantity: line.quantity,
    unitPrice: money(line.unitPrice),
    receivedQuantity: line.receivedQuantity,
    remainingQuantity: line.quantity - line.receivedQuantity,
    lineTotal: money(line.unitPrice.mul(line.quantity)),
  };
}

function mapOrder(order: OrderDetail) {
  const total = order.lines.reduce(
    (sum, line) => sum.add(line.unitPrice.mul(line.quantity)),
    new Prisma.Decimal(0),
  );
  return {
    id: order.id,
    number: order.number,
    reference: `PO-${String(order.number).padStart(4, '0')}`,
    status: order.status,
    note: order.note,
    supplier: order.supplier,
    location: order.location,
    createdBy: order.createdBy,
    decidedBy: order.decidedBy,
    decisionNote: order.decisionNote,
    decidedAt: order.decidedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    total: money(total),
    lines: order.lines.map(mapLine),
    receipts: order.receipts.map((receipt) => ({
      id: receipt.id,
      note: receipt.note,
      receivedBy: receipt.receivedBy,
      createdAt: receipt.createdAt,
      lines: receipt.lines.map((receiptLine) => ({
        id: receiptLine.id,
        purchaseOrderLineId: receiptLine.purchaseOrderLineId,
        product: receiptLine.orderLine.product,
        quantity: receiptLine.quantity,
      })),
    })),
  };
}

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireActiveSupplier(organizationId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { organizationId_id: { organizationId, id: supplierId } },
      select: { archivedAt: true },
    });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    if (supplier.archivedAt) throw new ConflictException('This supplier is archived.');
  }

  private async requireActiveLocation(organizationId: string, locationId: string) {
    const location = await this.prisma.location.findUnique({
      where: { organizationId_id: { organizationId, id: locationId } },
      select: { archivedAt: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    if (location.archivedAt) throw new ConflictException('This location is archived.');
  }

  async list(organizationId: string, query: ListPurchaseOrdersDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'all';
    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId,
      ...(status === 'all' ? {} : { status }),
    };
    const [orders, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          lines: { select: { quantity: true, unitPrice: true } },
        },
        orderBy: [{ number: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return {
      items: orders.map((order) => ({
        id: order.id,
        number: order.number,
        reference: `PO-${String(order.number).padStart(4, '0')}`,
        status: order.status,
        supplier: order.supplier,
        location: order.location,
        lineCount: order.lines.length,
        total: money(
          order.lines.reduce(
            (sum, line) => sum.add(line.unitPrice.mul(line.quantity)),
            new Prisma.Decimal(0),
          ),
        ),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  // Active products at or below their reorder point, with the last confirmed source.
  // Suggested quantity restocks to twice the reorder point.
  async suggestions(organizationId: string) {
    const rows = (await this.prisma.$queryRaw`
      WITH on_hand AS (
        SELECT product_id, SUM(quantity)::int AS total
        FROM stock_levels
        WHERE organization_id = ${organizationId}::uuid
        GROUP BY product_id
      ),
      latest_price AS (
        SELECT DISTINCT ON (l.product_id)
          l.product_id, l.unit_price, o.number,
          s.id AS supplier_id, s.name AS supplier_name, s.archived_at AS supplier_archived_at
        FROM purchase_order_lines l
        JOIN purchase_orders o ON o.id = l.purchase_order_id
        JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.organization_id = ${organizationId}::uuid
          AND o.status::text IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
        ORDER BY l.product_id, o.decided_at DESC, l.id DESC
      )
      SELECT p.id, p.sku, p.name, p.unit, p.reorder_point,
        COALESCE(h.total, 0) AS on_hand,
        lp.unit_price, lp.number, lp.supplier_id, lp.supplier_name, lp.supplier_archived_at
      FROM products p
      LEFT JOIN on_hand h ON h.product_id = p.id
      LEFT JOIN latest_price lp ON lp.product_id = p.id
      WHERE p.organization_id = ${organizationId}::uuid
        AND p.archived_at IS NULL
        AND p.reorder_point IS NOT NULL
        AND COALESCE(h.total, 0) <= p.reorder_point
      ORDER BY p.name ASC, p.id ASC
    `) as {
      id: string;
      sku: string;
      name: string;
      unit: string;
      reorder_point: number;
      on_hand: number;
      unit_price: string | null;
      number: number | null;
      supplier_id: string | null;
      supplier_name: string | null;
      supplier_archived_at: Date | null;
    }[];
    return {
      items: rows.map((row) => {
        const supplierUsable = row.supplier_id !== null && row.supplier_archived_at === null;
        return {
          product: { id: row.id, sku: row.sku, name: row.name, unit: row.unit },
          reorderPoint: row.reorder_point,
          onHand: row.on_hand,
          suggestedQuantity: Math.max(1, row.reorder_point * 2 - row.on_hand),
          supplier: supplierUsable
            ? { id: row.supplier_id as string, name: row.supplier_name as string }
            : null,
          unitPrice:
            supplierUsable && row.unit_price !== null
              ? new Prisma.Decimal(row.unit_price).toFixed(2)
              : null,
          reference:
            supplierUsable && row.number !== null
              ? `PO-${String(row.number).padStart(4, '0')}`
              : null,
        };
      }),
    };
  }

  async get(organizationId: string, orderId: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { organizationId_id: { organizationId, id: orderId } },
      include: detailInclude,
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    return mapOrder(order);
  }

  async create(organizationId: string, userId: string, input: CreatePurchaseOrderDto) {
    await this.requireActiveSupplier(organizationId, input.supplierId);
    await this.requireActiveLocation(organizationId, input.locationId);
    const orderId = await this.prisma.$transaction(async (tx) => {
      // Serialize numbering per organization.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const [{ next }] = await tx.$queryRaw<{ next: number }[]>`
        SELECT COALESCE(MAX(number), 0)::int + 1 AS next
        FROM purchase_orders WHERE organization_id = ${organizationId}::uuid
      `;
      const order = await tx.purchaseOrder.create({
        data: {
          organizationId,
          number: next,
          supplierId: input.supplierId,
          locationId: input.locationId,
          note: input.note ?? null,
          createdById: userId,
        },
        select: { id: true },
      });
      return order.id;
    });
    return this.get(organizationId, orderId);
  }

  async update(organizationId: string, orderId: string, input: UpdatePurchaseOrderDto) {
    if (input.supplierId) await this.requireActiveSupplier(organizationId, input.supplierId);
    if (input.locationId) await this.requireActiveLocation(organizationId, input.locationId);
    const updated = await this.prisma.purchaseOrder.updateMany({
      where: { id: orderId, organizationId, status: 'DRAFT' },
      data: {
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
    if (updated.count !== 1) await this.explainStateFailure(organizationId, orderId, ['DRAFT']);
    return this.get(organizationId, orderId);
  }

  private async explainStateFailure(
    organizationId: string,
    orderId: string,
    allowed: PurchaseOrderStatus[],
  ): Promise<never> {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { organizationId_id: { organizationId, id: orderId } },
      select: { status: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    throw new ConflictException(
      `This action requires the order to be ${allowed.join(' or ').toLowerCase()}; it is ${order.status.toLowerCase().replaceAll('_', ' ')}.`,
    );
  }

  async addLine(organizationId: string, orderId: string, input: OrderLineDto) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { organizationId_id: { organizationId, id: orderId } },
      select: { status: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found.');
    if (order.status !== 'DRAFT')
      throw new ConflictException('Lines can only be changed on draft orders.');
    const product = await this.prisma.product.findUnique({
      where: { organizationId_id: { organizationId, id: input.productId } },
      select: { archivedAt: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (product.archivedAt) throw new ConflictException('This product is archived.');
    try {
      await this.prisma.purchaseOrderLine.create({
        data: {
          organizationId,
          purchaseOrderId: orderId,
          productId: input.productId,
          quantity: input.quantity,
          unitPrice: new Prisma.Decimal(input.unitPrice),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This product is already on the order.');
      }
      throw error;
    }
    return this.get(organizationId, orderId);
  }

  async updateLine(
    organizationId: string,
    orderId: string,
    lineId: string,
    input: UpdateOrderLineDto,
  ) {
    const updated = await this.prisma.purchaseOrderLine.updateMany({
      where: {
        id: lineId,
        organizationId,
        purchaseOrderId: orderId,
        purchaseOrder: { status: 'DRAFT' },
      },
      data: {
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.unitPrice !== undefined
          ? { unitPrice: new Prisma.Decimal(input.unitPrice) }
          : {}),
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('Lines can only be changed on draft orders.');
    return this.get(organizationId, orderId);
  }

  async removeLine(organizationId: string, orderId: string, lineId: string) {
    const removed = await this.prisma.purchaseOrderLine.deleteMany({
      where: {
        id: lineId,
        organizationId,
        purchaseOrderId: orderId,
        purchaseOrder: { status: 'DRAFT' },
      },
    });
    if (removed.count !== 1)
      throw new ConflictException('Lines can only be changed on draft orders.');
    return this.get(organizationId, orderId);
  }

  async submit(organizationId: string, orderId: string) {
    const updated = await this.prisma.purchaseOrder.updateMany({
      where: { id: orderId, organizationId, status: 'DRAFT', lines: { some: {} } },
      data: { status: 'SUBMITTED' },
    });
    if (updated.count !== 1) {
      const order = await this.prisma.purchaseOrder.findUnique({
        where: { organizationId_id: { organizationId, id: orderId } },
        select: { status: true, _count: { select: { lines: true } } },
      });
      if (!order) throw new NotFoundException('Purchase order not found.');
      if (order.status === 'DRAFT' && order._count.lines === 0)
        throw new ConflictException('Add at least one line before submitting.');
      throw new ConflictException('Only draft orders can be submitted.');
    }
    return this.get(organizationId, orderId);
  }

  async decide(
    organizationId: string,
    orderId: string,
    userId: string,
    approve: boolean,
    note: string | null,
  ) {
    const updated = await this.prisma.purchaseOrder.updateMany({
      where: { id: orderId, organizationId, status: 'SUBMITTED' },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedById: userId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (updated.count !== 1) await this.explainStateFailure(organizationId, orderId, ['SUBMITTED']);
    return this.get(organizationId, orderId);
  }

  async cancel(organizationId: string, orderId: string) {
    const updated = await this.prisma.purchaseOrder.updateMany({
      where: {
        id: orderId,
        organizationId,
        OR: [
          { status: { in: ['DRAFT', 'SUBMITTED'] } },
          { status: 'APPROVED', receipts: { none: {} } },
        ],
      },
      data: { status: 'CANCELLED' },
    });
    if (updated.count !== 1) {
      const order = await this.prisma.purchaseOrder.findUnique({
        where: { organizationId_id: { organizationId, id: orderId } },
        select: { status: true, _count: { select: { receipts: true } } },
      });
      if (!order) throw new NotFoundException('Purchase order not found.');
      if (order._count.receipts > 0)
        throw new ConflictException('Orders with recorded deliveries cannot be cancelled.');
      throw new ConflictException('This order can no longer be cancelled.');
    }
    return this.get(organizationId, orderId);
  }

  async receive(organizationId: string, orderId: string, userId: string, input: CreateReceiptDto) {
    const requested = new Map<string, number>();
    for (const line of input.lines) {
      if (requested.has(line.purchaseOrderLineId))
        throw new BadRequestException('Each order line can appear only once per receipt.');
      requested.set(line.purchaseOrderLineId, line.quantity);
    }

    await this.prisma.$transaction(async (tx) => {
      // Serialize competing receipts for the same order.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM purchase_orders
        WHERE id = ${orderId}::uuid AND organization_id = ${organizationId}::uuid
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new NotFoundException('Purchase order not found.');
      const order = await tx.purchaseOrder.findUniqueOrThrow({
        where: { organizationId_id: { organizationId, id: orderId } },
        select: { status: true, locationId: true, lines: true },
      });
      if (order.status !== 'APPROVED' && order.status !== 'PARTIALLY_RECEIVED')
        throw new ConflictException('Only approved orders can receive deliveries.');

      const linesById = new Map(order.lines.map((line) => [line.id, line]));
      for (const [lineId, quantity] of requested) {
        const line = linesById.get(lineId);
        if (!line) throw new NotFoundException('Order line not found on this order.');
        const remaining = line.quantity - line.receivedQuantity;
        if (quantity > remaining)
          throw new ConflictException(
            `Receipt exceeds the remaining quantity for ${lineId}. Remaining: ${remaining}.`,
          );
      }

      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId,
          purchaseOrderId: orderId,
          note: input.note ?? null,
          receivedById: userId,
        },
        select: { id: true },
      });

      for (const [lineId, quantity] of requested) {
        const line = linesById.get(lineId)!;
        const receiptLine = await tx.goodsReceiptLine.create({
          data: {
            goodsReceiptId: receipt.id,
            purchaseOrderId: orderId,
            purchaseOrderLineId: lineId,
            quantity,
          },
          select: { id: true },
        });
        await tx.purchaseOrderLine.update({
          where: { id: lineId },
          data: { receivedQuantity: { increment: quantity } },
        });
        await tx.stockMovement.create({
          data: {
            organizationId,
            productId: line.productId,
            locationId: order.locationId,
            type: 'RECEIPT',
            quantity,
            goodsReceiptLineId: receiptLine.id,
            createdById: userId,
          },
        });
        await tx.stockLevel.upsert({
          where: {
            organizationId_productId_locationId: {
              organizationId,
              productId: line.productId,
              locationId: order.locationId,
            },
          },
          create: {
            organizationId,
            productId: line.productId,
            locationId: order.locationId,
            quantity,
          },
          update: { quantity: { increment: quantity } },
        });
      }

      const remainingTotal = await tx.purchaseOrderLine.aggregate({
        where: { purchaseOrderId: orderId },
        _sum: { quantity: true, receivedQuantity: true },
      });
      const fullyReceived =
        (remainingTotal._sum.quantity ?? 0) === (remainingTotal._sum.receivedQuantity ?? 0);
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });
    });
    return this.get(organizationId, orderId);
  }
}
