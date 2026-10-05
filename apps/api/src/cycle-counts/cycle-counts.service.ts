import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PageQueryDto } from '../common/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { OpenCycleCountDto } from './cycle-counts.dto';

const countSelect = {
  id: true,
  status: true,
  note: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  completedBy: { select: { id: true, displayName: true } },
} as const;

const lineSelect = {
  id: true,
  expectedQuantity: true,
  countedQuantity: true,
  updatedAt: true,
  product: { select: { id: true, sku: true, name: true, unit: true } },
} as const;

@Injectable()
export class CycleCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async open(actorId: string, organizationId: string, input: OpenCycleCountDto) {
    const location = await this.prisma.location.findUnique({
      where: { organizationId_id: { organizationId, id: input.locationId } },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!location) throw new NotFoundException('Location not found.');
    if (location.archivedAt) {
      throw new ConflictException('Archived locations cannot be counted.');
    }
    const count = await this.prisma.cycleCount.create({
      data: {
        organizationId,
        locationId: location.id,
        note: input.note ?? null,
        createdById: actorId,
      },
      select: { id: true },
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'count.opened',
      entityType: 'cycle_count',
      entityId: count.id,
      summary: `Opened a cycle count at ${location.name}`,
    });
    // The same shape as GET so clients can route straight to the session.
    return this.get(organizationId, count.id);
  }

  async list(organizationId: string, query: PageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { organizationId };
    const [rows, total] = await Promise.all([
      this.prisma.cycleCount.findMany({
        where,
        select: { ...countSelect, _count: { select: { lines: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.cycleCount.count({ where }),
    ]);
    const items = rows.map(({ _count, ...count }) => ({ ...count, lineCount: _count.lines }));
    return { items, total, page, pageSize };
  }

  async get(organizationId: string, countId: string) {
    const count = await this.prisma.cycleCount.findFirst({
      where: { id: countId, organizationId },
      select: {
        ...countSelect,
        lines: {
          select: lineSelect,
          orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
        },
      },
    });
    if (!count) throw new NotFoundException('Cycle count not found.');
    return count;
  }

  private async requireOpen(organizationId: string, countId: string) {
    const count = await this.prisma.cycleCount.findFirst({
      where: { id: countId, organizationId },
      select: { id: true, status: true, locationId: true, location: { select: { name: true } } },
    });
    if (!count) throw new NotFoundException('Cycle count not found.');
    if (count.status !== 'OPEN') {
      throw new ConflictException('Only open counts can be changed.');
    }
    return count;
  }

  // The expected quantity snapshots the live balance every time the line is saved.
  async recordLine(
    organizationId: string,
    countId: string,
    productId: string,
    countedQuantity: number,
  ) {
    const count = await this.requireOpen(organizationId, countId);
    const product = await this.prisma.product.findUnique({
      where: { organizationId_id: { organizationId, id: productId } },
      select: { archivedAt: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (product.archivedAt) {
      throw new ConflictException('Archived products cannot be counted.');
    }
    const level = await this.prisma.stockLevel.findUnique({
      where: {
        organizationId_productId_locationId: {
          organizationId,
          productId,
          locationId: count.locationId,
        },
      },
      select: { quantity: true },
    });
    const expectedQuantity = level?.quantity ?? 0;
    return this.prisma.cycleCountLine.upsert({
      where: { cycleCountId_productId: { cycleCountId: countId, productId } },
      create: {
        cycleCountId: countId,
        organizationId,
        productId,
        expectedQuantity,
        countedQuantity,
      },
      update: { expectedQuantity, countedQuantity },
      select: lineSelect,
    });
  }

  async removeLine(organizationId: string, countId: string, productId: string) {
    await this.requireOpen(organizationId, countId);
    const removed = await this.prisma.cycleCountLine.deleteMany({
      where: { cycleCountId: countId, organizationId, productId },
    });
    if (removed.count !== 1) throw new NotFoundException('This product is not in the count.');
  }

  async cancel(actorId: string, organizationId: string, countId: string) {
    const count = await this.requireOpen(organizationId, countId);
    const updated = await this.prisma.cycleCount.updateMany({
      where: { id: countId, status: 'OPEN' },
      data: { status: 'CANCELLED' },
    });
    if (updated.count !== 1) throw new ConflictException('Only open counts can be changed.');
    await this.audit.record({
      organizationId,
      actorId,
      action: 'count.cancelled',
      entityType: 'cycle_count',
      entityId: countId,
      summary: `Cancelled a cycle count at ${count.location.name}`,
    });
    return this.get(organizationId, countId);
  }

  // Variances are posted against the balance at completion time, not the stale snapshot.
  async complete(actorId: string, organizationId: string, countId: string) {
    const count = await this.requireOpen(organizationId, countId);
    const lines = await this.prisma.cycleCountLine.findMany({
      where: { cycleCountId: countId },
      select: { productId: true, countedQuantity: true },
      orderBy: { productId: 'asc' },
    });
    if (lines.length === 0) {
      throw new BadRequestException('Record at least one count before completing.');
    }
    const adjustments = await this.prisma.$transaction(async (tx) => {
      // Claim the session first so competing completions cannot double-post.
      const claimed = await tx.cycleCount.updateMany({
        where: { id: countId, status: 'OPEN' },
        data: { status: 'COMPLETED', completedById: actorId, completedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('Only open counts can be changed.');
      let changed = 0;
      for (const line of lines) {
        const locked = (await tx.$queryRaw`
          SELECT quantity FROM stock_levels
          WHERE organization_id = ${organizationId}::uuid
            AND product_id = ${line.productId}::uuid
            AND location_id = ${count.locationId}::uuid
          FOR UPDATE
        `) as { quantity: number }[];
        const live = locked[0]?.quantity ?? 0;
        const variance = line.countedQuantity - live;
        await tx.cycleCountLine.update({
          where: { cycleCountId_productId: { cycleCountId: countId, productId: line.productId } },
          data: { expectedQuantity: live },
        });
        if (variance === 0) continue;
        const adjustment = await tx.stockAdjustment.create({
          data: {
            organizationId,
            productId: line.productId,
            locationId: count.locationId,
            quantity: variance,
            reason: `Cycle count at ${count.location.name}`,
            createdById: actorId,
          },
          select: { id: true },
        });
        await tx.stockMovement.create({
          data: {
            organizationId,
            productId: line.productId,
            locationId: count.locationId,
            type: 'ADJUSTMENT',
            quantity: variance,
            stockAdjustmentId: adjustment.id,
            createdById: actorId,
          },
        });
        if (locked.length === 1) {
          await tx.stockLevel.update({
            where: {
              organizationId_productId_locationId: {
                organizationId,
                productId: line.productId,
                locationId: count.locationId,
              },
            },
            data: { quantity: line.countedQuantity },
          });
        } else {
          await tx.stockLevel.create({
            data: {
              organizationId,
              productId: line.productId,
              locationId: count.locationId,
              quantity: line.countedQuantity,
            },
          });
        }
        changed += 1;
      }
      return changed;
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'count.completed',
      entityType: 'cycle_count',
      entityId: countId,
      summary: `Completed a cycle count at ${count.location.name} with ${adjustments} ${
        adjustments === 1 ? 'adjustment' : 'adjustments'
      }`,
    });
    return this.get(organizationId, countId);
  }
}
