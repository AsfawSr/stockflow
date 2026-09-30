import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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
