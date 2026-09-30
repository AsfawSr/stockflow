import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, ListProductsDto, UpdateProductDto } from './products.dto';

const productSelect = {
  id: true,
  sku: true,
  name: true,
  description: true,
  unit: true,
  reorderPoint: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private duplicateSku(error: unknown): never | void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('This SKU is already used in this organization.');
    }
  }

  async list(organizationId: string, query: ListProductsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const status = query.status ?? 'active';
    const where: Prisma.ProductWhereInput = {
      organizationId,
      ...(status === 'active' ? { archivedAt: null } : {}),
      ...(status === 'archived' ? { archivedAt: { not: null } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: productSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async get(organizationId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { organizationId_id: { organizationId, id: productId } },
      select: productSelect,
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  async create(organizationId: string, input: CreateProductDto) {
    try {
      return await this.prisma.product.create({
        data: {
          organizationId,
          sku: input.sku,
          name: input.name,
          unit: input.unit,
          description: input.description ?? null,
          reorderPoint: input.reorderPoint ?? null,
        },
        select: productSelect,
      });
    } catch (error) {
      this.duplicateSku(error);
      throw error;
    }
  }

  async update(organizationId: string, productId: string, input: UpdateProductDto) {
    try {
      const updated = await this.prisma.product.updateMany({
        where: { id: productId, organizationId },
        data: {
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
        },
      });
      if (updated.count !== 1) throw new NotFoundException('Product not found.');
    } catch (error) {
      this.duplicateSku(error);
      throw error;
    }
    return this.get(organizationId, productId);
  }

  async setArchived(organizationId: string, productId: string, archived: boolean) {
    const updated = await this.prisma.product.updateMany({
      where: {
        id: productId,
        organizationId,
        archivedAt: archived ? null : { not: null },
      },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.product.findUnique({
        where: { organizationId_id: { organizationId, id: productId } },
        select: { archivedAt: true },
      });
      if (!exists) throw new NotFoundException('Product not found.');
      throw new ConflictException(
        archived ? 'This product is already archived.' : 'This product is not archived.',
      );
    }
    return this.get(organizationId, productId);
  }
}
