import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateOrganizationDto,
  RenameOrganizationDto,
  UpdateMemberRolesDto,
} from './organizations.dto';

const organizationSelect = {
  id: true,
  name: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async rename(userId: string, organizationId: string, input: RenameOrganizationDto) {
    try {
      return await this.prisma.organization.update({
        where: { id: organizationId, memberships: { some: { userId, roles: { has: 'ADMIN' } } } },
        data: { name: input.name },
        select: organizationSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Organization not found.');
      }
      throw error;
    }
  }

  members(userId: string, organizationId: string) {
    return this.prisma.membership.findMany({
      where: {
        organizationId,
        organization: { memberships: { some: { userId, roles: { has: 'ADMIN' } } } },
      },
      select: {
        roles: true,
        createdAt: true,
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
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

  updateMemberRoles(organizationId: string, memberUserId: string, input: UpdateMemberRolesDto) {
    return this.prisma.$transaction(async (tx) => {
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
  }

  removeMember(organizationId: string, memberUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const membership = await tx.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId: memberUserId } },
        select: { id: true, roles: true },
      });
      if (!membership) throw new NotFoundException('Member not found.');
      await this.requireOtherAdminsRemain(tx, organizationId, membership);
      await tx.membership.delete({ where: { id: membership.id } });
    });
  }
}
