import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ListQueryDto } from '../common/list-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLocationDto, UpdateLocationDto } from './locations.dto';

const locationSelect = {
  id: true,
  name: true,
  address: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private duplicateName(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('This location name is already used in this organization.');
    }
  }

  async list(organizationId: string, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'active';
    const where: Prisma.LocationWhereInput = {
      organizationId,
      ...(status === 'active' ? { archivedAt: null } : {}),
      ...(status === 'archived' ? { archivedAt: { not: null } } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        select: locationSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.location.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(organizationId: string, locationId: string) {
    const location = await this.prisma.location.findUnique({
      where: { organizationId_id: { organizationId, id: locationId } },
      select: locationSelect,
    });
    if (!location) throw new NotFoundException('Location not found.');
    return location;
  }

  async create(organizationId: string, input: CreateLocationDto) {
    try {
      return await this.prisma.location.create({
        data: { organizationId, name: input.name, address: input.address ?? null },
        select: locationSelect,
      });
    } catch (error) {
      this.duplicateName(error);
      throw error;
    }
  }

  async update(organizationId: string, locationId: string, input: UpdateLocationDto) {
    try {
      const updated = await this.prisma.location.updateMany({
        where: { id: locationId, organizationId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
        },
      });
      if (updated.count !== 1) throw new NotFoundException('Location not found.');
    } catch (error) {
      this.duplicateName(error);
      throw error;
    }
    return this.get(organizationId, locationId);
  }

  async setArchived(organizationId: string, locationId: string, archived: boolean) {
    const updated = await this.prisma.location.updateMany({
      where: { id: locationId, organizationId, archivedAt: archived ? null : { not: null } },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.location.findUnique({
        where: { organizationId_id: { organizationId, id: locationId } },
        select: { archivedAt: true },
      });
      if (!exists) throw new NotFoundException('Location not found.');
      throw new ConflictException(
        archived ? 'This location is already archived.' : 'This location is not archived.',
      );
    }
    return this.get(organizationId, locationId);
  }
}
