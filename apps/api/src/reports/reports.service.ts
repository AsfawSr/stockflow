import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PageQueryDto } from '../common/list-query.dto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';

const snapshotSelect = {
  id: true,
  type: true,
  payload: true,
  createdAt: true,
  createdBy: { select: { id: true, displayName: true } },
} as const;

type ValuationPayload = {
  currency: string;
  totalValue: string;
  items: unknown[];
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  // The payload is computed server-side so a snapshot always reflects the real ledger.
  async createValuationSnapshot(actorId: string, organizationId: string) {
    const [organization, valuation] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { currency: true },
      }),
      this.stock.valuation(organizationId),
    ]);
    const payload: ValuationPayload = {
      currency: organization.currency,
      totalValue: valuation.totalValue,
      items: valuation.items,
    };
    const snapshot = await this.prisma.reportSnapshot.create({
      data: {
        organizationId,
        type: 'valuation',
        payload: payload as unknown as Prisma.InputJsonValue,
        createdById: actorId,
      },
      select: snapshotSelect,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'report.snapshot_created',
      entityType: 'report_snapshot',
      entityId: snapshot.id,
      summary: `Saved a valuation snapshot of ${payload.totalValue} ${payload.currency}`,
    });
    return snapshot;
  }

  async listValuationSnapshots(organizationId: string, query: PageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { organizationId, type: 'valuation' };
    const [rows, total] = await Promise.all([
      this.prisma.reportSnapshot.findMany({
        where,
        select: snapshotSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reportSnapshot.count({ where }),
    ]);
    const items = rows.map((row) => {
      const payload = row.payload as ValuationPayload;
      return {
        id: row.id,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        currency: payload.currency,
        totalValue: payload.totalValue,
        productCount: payload.items.length,
      };
    });
    return { items, total, page, pageSize };
  }

  async getValuationSnapshot(organizationId: string, snapshotId: string) {
    const snapshot = await this.prisma.reportSnapshot.findFirst({
      where: { id: snapshotId, organizationId, type: 'valuation' },
      select: snapshotSelect,
    });
    if (!snapshot) throw new NotFoundException('This snapshot no longer exists.');
    return snapshot;
  }
}
