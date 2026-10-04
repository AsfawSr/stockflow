import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PageQueryDto } from '../common/list-query.dto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOrganizationDto,
  UpdateMemberRolesDto,
  UpdateOrganizationDto,
} from './organizations.dto';

const organizationSelect = {
  id: true,
  name: true,
  currency: true,
  replyToEmail: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { roles: true, organization: { select: organizationSelect } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return memberships.map(({ organization, roles }) => ({ ...organization, roles }));
  }

  create(userId: string, input: CreateOrganizationDto) {
    return this.prisma.organization.create({
      data: {
        name: input.name,
        currency: input.currency,
        memberships: { create: { userId, roles: ['ADMIN'] } },
      },
      select: organizationSelect,
    });
  }

  async get(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { roles: true, organization: { select: organizationSelect } },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return { ...membership.organization, roles: membership.roles };
  }

  // Eight ISO weeks of activity, oldest first, with empty weeks kept as zeros.
  async trends(organizationId: string) {
    const rows = (await this.prisma.$queryRaw`
      WITH weeks AS (
        SELECT (date_trunc('week', (now() AT TIME ZONE 'UTC'))::date - (n * 7)) AS week_start
        FROM generate_series(0, 7) AS n
      )
      SELECT w.week_start,
        (SELECT COUNT(*)::int FROM purchase_orders o
          WHERE o.organization_id = ${organizationId}::uuid
            AND date_trunc('week', (o.created_at AT TIME ZONE 'UTC'))::date = w.week_start)
          AS orders_created,
        (SELECT COALESCE(SUM(m.quantity), 0)::int FROM stock_movements m
          WHERE m.organization_id = ${organizationId}::uuid AND m.type::text = 'RECEIPT'
            AND date_trunc('week', (m.created_at AT TIME ZONE 'UTC'))::date = w.week_start)
          AS units_received,
        (SELECT COUNT(*)::int FROM stock_movements m
          WHERE m.organization_id = ${organizationId}::uuid
            AND date_trunc('week', (m.created_at AT TIME ZONE 'UTC'))::date = w.week_start)
          AS movements
      FROM weeks w
      ORDER BY w.week_start ASC
    `) as {
      week_start: Date;
      orders_created: number;
      units_received: number;
      movements: number;
    }[];
    return {
      weeks: rows.map((row) => ({
        weekStart: row.week_start.toISOString().slice(0, 10),
        ordersCreated: row.orders_created,
        unitsReceived: row.units_received,
        movements: row.movements,
      })),
    };
  }

  async update(userId: string, organizationId: string, input: UpdateOrganizationDto) {
    if (input.name === undefined && input.replyToEmail === undefined)
      throw new BadRequestException('Provide a name or reply-to email to update.');
    try {
      return await this.prisma.organization.update({
        where: { id: organizationId, memberships: { some: { userId, roles: { has: 'ADMIN' } } } },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.replyToEmail !== undefined ? { replyToEmail: input.replyToEmail } : {}),
        },
        select: organizationSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Organization not found.');
      }
      throw error;
    }
  }

  // Archiving freezes the workspace; history stays readable and restorable.
  async archive(userId: string, organizationId: string) {
    const updated = await this.prisma.organization.updateMany({
      where: { id: organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException('This organization is already archived.');
    await this.audit.record({
      organizationId,
      actorId: userId,
      action: 'organization.archived',
      entityType: 'organization',
      entityId: organizationId,
      summary: 'Archived the organization',
    });
    return this.get(userId, organizationId);
  }

  async members(userId: string, organizationId: string, query: PageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      organizationId,
      organization: { memberships: { some: { userId, roles: { has: 'ADMIN' as const } } } },
    };
    const [items, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        select: {
          roles: true,
          createdAt: true,
          user: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.membership.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // Locks the organization row so competing admin-set changes serialize.
  private async requireOtherAdminsRemain(
    tx: Prisma.TransactionClient,
    organizationId: string,
    membership: { roles: string[] },
  ) {
    if (!membership.roles.includes('ADMIN')) return;
    const admins = await tx.membership.count({
      where: { organizationId, roles: { has: 'ADMIN' } },
    });
    if (admins <= 1)
      throw new ConflictException('An organization needs at least one administrator.');
  }

  async updateMemberRoles(
    organizationId: string,
    actorId: string,
    memberUserId: string,
    input: UpdateMemberRolesDto,
  ) {
    const member = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const membership = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId: memberUserId } },
        select: { id: true, roles: true },
      });
      if (!membership) throw new NotFoundException('Member not found.');
      if (!input.roles.includes('ADMIN'))
        await this.requireOtherAdminsRemain(tx, organizationId, membership);
      return tx.membership.update({
        where: { id: membership.id },
        data: { roles: input.roles },
        select: {
          roles: true,
          createdAt: true,
          user: { select: { id: true, email: true, displayName: true } },
        },
      });
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'member.roles_changed',
      entityType: 'membership',
      entityId: memberUserId,
      summary: `Changed roles for ${member.user.email} to ${member.roles.join(', ')}`,
    });
    return member;
  }

  async removeMember(organizationId: string, actorId: string, memberUserId: string) {
    const email = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const membership = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId: memberUserId } },
        select: { id: true, roles: true, user: { select: { email: true } } },
      });
      if (!membership) throw new NotFoundException('Member not found.');
      await this.requireOtherAdminsRemain(tx, organizationId, membership);
      await tx.membership.delete({ where: { id: membership.id } });
      return membership.user.email;
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'member.removed',
      entityType: 'membership',
      entityId: memberUserId,
      summary: `Removed ${email} from the organization`,
    });
  }
}
