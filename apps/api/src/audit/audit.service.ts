import { Injectable, Logger } from '@nestjs/common';
import { PageQueryDto } from '../common/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';

export type AuditEntry = {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Best effort: a failed audit write never fails the action it describes.
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          organizationId: entry.organizationId,
          actorId: entry.actorId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          summary: entry.summary.slice(0, 400),
        },
      });
    } catch {
      this.logger.warn(`Audit write failed for ${entry.action}.`);
    }
  }

  async list(organizationId: string, query: PageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { organizationId };
    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          summary: true,
          createdAt: true,
          actor: { select: { id: true, displayName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
