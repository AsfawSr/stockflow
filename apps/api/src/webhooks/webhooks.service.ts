import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PageQueryDto } from '../common/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';

const endpointSelect = {
  id: true,
  url: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    const items = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      select: endpointSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { items };
  }

  async deliveries(organizationId: string, webhookId: string, query: PageQueryDto) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, organizationId },
      select: { id: true, url: true },
    });
    if (!endpoint) throw new NotFoundException('This webhook no longer exists.');
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { webhookEndpointId: webhookId };
    const [items, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        select: {
          id: true,
          event: true,
          body: true,
          status: true,
          attempts: true,
          responseStatus: true,
          lastError: true,
          nextAttemptAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return { url: endpoint.url, items, total, page, pageSize };
  }

  // The signing secret is generated here and returned exactly once.
  async create(actorId: string, organizationId: string, url: string) {
    const secret = randomBytes(32).toString('hex');
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { organizationId, url, secret },
      select: endpointSelect,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'webhook.created',
      entityType: 'webhook',
      entityId: endpoint.id,
      summary: `Added a webhook for ${url}`,
    });
    return { ...endpoint, secret };
  }

  async update(actorId: string, organizationId: string, webhookId: string, active: boolean) {
    const result = await this.prisma.webhookEndpoint.updateMany({
      where: { id: webhookId, organizationId },
      data: { active },
    });
    if (result.count !== 1) throw new NotFoundException('This webhook no longer exists.');
    const endpoint = await this.prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id: webhookId },
      select: endpointSelect,
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: active ? 'webhook.enabled' : 'webhook.disabled',
      entityType: 'webhook',
      entityId: webhookId,
      summary: `${active ? 'Enabled' : 'Disabled'} the webhook for ${endpoint.url}`,
    });
    return endpoint;
  }

  async remove(actorId: string, organizationId: string, webhookId: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, organizationId },
      select: { url: true },
    });
    const result = await this.prisma.webhookEndpoint.deleteMany({
      where: { id: webhookId, organizationId },
    });
    if (!endpoint || result.count !== 1)
      throw new NotFoundException('This webhook no longer exists.');
    await this.audit.record({
      organizationId,
      actorId,
      action: 'webhook.deleted',
      entityType: 'webhook',
      entityId: webhookId,
      summary: `Removed the webhook for ${endpoint.url}`,
    });
  }
}
