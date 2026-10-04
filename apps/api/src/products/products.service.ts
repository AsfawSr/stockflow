import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { parseCsv } from '../common/csv';
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

const importColumns = ['sku', 'name', 'unit', 'description', 'reorder_point'] as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  // All-or-nothing: every row is validated before anything is written.
  async importCsv(organizationId: string, actorId: string, csv: string) {
    const fail = (errors: { line: number; message: string }[]): never => {
      throw new BadRequestException({ message: 'The CSV could not be imported.', errors });
    };
    let rows: string[][];
    try {
      rows = parseCsv(csv);
    } catch (error) {
      return fail([{ line: 1, message: (error as Error).message }]);
    }
    if (rows.length === 0) return fail([{ line: 1, message: 'The file is empty.' }]);
    const header = rows[0].map((column) => column.trim().toLowerCase());
    const unknown = header.find(
      (column) => !importColumns.includes(column as (typeof importColumns)[number]),
    );
    if (unknown) return fail([{ line: 1, message: `Unknown column "${unknown}".` }]);
    for (const required of ['sku', 'name', 'unit']) {
      if (!header.includes(required))
        return fail([{ line: 1, message: `Missing required column "${required}".` }]);
    }
    if (rows.length === 1) return fail([{ line: 1, message: 'Add at least one product row.' }]);

    const errors: { line: number; message: string }[] = [];
    const seen = new Set<string>();
    const products: {
      sku: string;
      name: string;
      unit: string;
      description: string | null;
      reorderPoint: number | null;
    }[] = [];
    rows.slice(1).forEach((cells, index) => {
      const line = index + 2;
      const value = (column: string) => (cells[header.indexOf(column)] ?? '').trim();
      const sku = value('sku').toUpperCase();
      const name = value('name');
      const unit = value('unit');
      const description = header.includes('description') ? value('description') : '';
      const reorderRaw = header.includes('reorder_point') ? value('reorder_point') : '';
      if (cells.length > header.length) errors.push({ line, message: 'Too many columns.' });
      if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(sku) || sku.length > 64)
        errors.push({
          line,
          message: 'SKU must use letters, digits, dots, underscores, or hyphens.',
        });
      else if (seen.has(sku)) errors.push({ line, message: `Duplicate SKU "${sku}" in the file.` });
      else seen.add(sku);
      if (!name || name.length > 160)
        errors.push({ line, message: 'Enter a name up to 160 characters.' });
      if (!unit || unit.length > 32)
        errors.push({ line, message: 'Enter a unit up to 32 characters.' });
      if (description.length > 2000) errors.push({ line, message: 'Description is too long.' });
      let reorderPoint: number | null = null;
      if (reorderRaw !== '') {
        reorderPoint = Number(reorderRaw);
        if (!Number.isInteger(reorderPoint) || reorderPoint < 0 || reorderPoint > 1000000) {
          errors.push({ line, message: 'Reorder point must be a whole number up to 1000000.' });
        }
      }
      products.push({ sku, name, unit, description: description || null, reorderPoint });
    });
    if (seen.size > 0) {
      const existing = await this.prisma.product.findMany({
        where: { organizationId, sku: { in: [...seen] } },
        select: { sku: true },
      });
      const taken = new Set(existing.map((product) => product.sku));
      products.forEach((product, index) => {
        if (taken.has(product.sku))
          errors.push({ line: index + 2, message: `SKU "${product.sku}" already exists.` });
      });
    }
    if (errors.length > 0) return fail(errors);

    await this.prisma.product.createMany({
      data: products.map((product) => ({ organizationId, ...product })),
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: 'product.imported',
      entityType: 'product',
      summary: `Imported ${products.length} ${products.length === 1 ? 'product' : 'products'} from CSV`,
    });
    return { created: products.length };
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
