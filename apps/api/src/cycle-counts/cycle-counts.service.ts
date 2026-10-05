import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
      select: countSelect,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'count.opened',
      entityType: 'cycle_count',
      entityId: count.id,
      summary: `Opened a cycle count at ${location.name}`,
    });
    return count;
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
}
