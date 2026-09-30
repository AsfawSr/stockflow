import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Product database constraints', () => {
  let client: Client;
  let prisma: PrismaService;
  let organizationId: string;

  beforeAll(async () => {
    config({ quiet: true });
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for database tests.');
    client = new Client({
      connectionString,
      options: '-c timezone=UTC',
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: connectionString }));
    await client.connect();
  });

  beforeEach(async () => {
    organizationId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Product Test Organization', 'USD'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });
  afterAll(async () => {
    await client?.end();
    await prisma?.$disconnect();
  });

  function insertProduct(
    overrides: Partial<{
      organizationId: string | null;
      sku: string;
      name: string;
      description: string | null;
      unit: string;
    }> = {},
  ) {
    const product = {
      organizationId,
      sku: 'USB-C_65W.01',
      name: 'USB-C Charger',
      description: null,
      unit: 'piece',
      ...overrides,
    };
    return client.query(
      'INSERT INTO products (id, organization_id, sku, name, description, unit, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id',
      [
        randomUUID(),
        product.organizationId,
        product.sku,
        product.name,
        product.description,
        product.unit,
      ],
    );
  }

  it('creates, scopes, archives, and restores a product through Prisma without changing its identity', async () => {
    const rollback = new Error('Rollback product test transaction');
    const productId = randomUUID();
    await expect(
      prisma.$transaction(async (transaction) => {
        const owner = await transaction.organization.create({
          data: { name: 'Product Owner', currency: 'USD' },
        });
        const other = await transaction.organization.create({
          data: { name: 'Other Organization', currency: 'ETB' },
        });
        const product = await transaction.product.create({
          data: {
            id: productId,
            organizationId: owner.id,
            sku: 'USB-C_65W.01',
            name: 'USB-C Charger',
            unit: 'piece',
          },
        });
        expect(product.description).toBeNull();
        expect(product.archivedAt).toBeNull();
        expect(product.createdAt).toBeInstanceOf(Date);
        expect(product.updatedAt).toBeInstanceOf(Date);
        const scopedKey = { organizationId_id: { organizationId: owner.id, id: product.id } };
        expect(await transaction.product.findUnique({ where: scopedKey })).toMatchObject({
          id: product.id,
        });
        expect(
          await transaction.product.findUnique({
            where: { organizationId_id: { organizationId: other.id, id: product.id } },
          }),
        ).toBeNull();
        const archivedAt = new Date();
        const archived = await transaction.product.update({
          where: scopedKey,
          data: { archivedAt, description: '65 watt charger' },
        });
        expect(archived.archivedAt?.toISOString()).toBe(archivedAt.toISOString());
        expect(
          await transaction.product.count({
            where: { organizationId: owner.id, archivedAt: null },
          }),
        ).toBe(0);
        const restored = await transaction.product.update({
          where: scopedKey,
          data: { archivedAt: null },
        });
        expect(restored.id).toBe(product.id);
        expect(restored.sku).toBe(product.sku);
        expect(restored.description).toBe('65 watt charger');
        expect(
          await transaction.product.count({
            where: { organizationId: owner.id, archivedAt: null },
          }),
        ).toBe(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await prisma.product.findUnique({ where: { id: productId } })).toBeNull();
  });

  it('rejects a duplicate SKU within one organization', async () => {
    await insertProduct();
    await expect(insertProduct()).rejects.toMatchObject({
      code: '23505',
      constraint: 'products_organization_id_sku_key',
    });
  });

  it('keeps archived SKUs reserved in their organization', async () => {
    const created = await insertProduct();
    await client.query('UPDATE products SET archived_at = now() WHERE id = $1', [
      created.rows[0].id,
    ]);
    await expect(insertProduct()).rejects.toMatchObject({
      code: '23505',
      constraint: 'products_organization_id_sku_key',
    });
  });

  it('allows the same SKU in different organizations', async () => {
    await insertProduct();
    const otherId = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [otherId, 'Other Product Organization', 'ETB'],
    );
    await expect(insertProduct({ organizationId: otherId })).resolves.toMatchObject({
      rowCount: 1,
    });
  });

  it.each(['usb-001', ' SKU-001', 'SKU-001 ', '', 'SKU 001', '!SKU', 'SKU/001'])(
    'rejects a noncanonical SKU: %j',
    async (sku) => {
      await expect(insertProduct({ sku })).rejects.toMatchObject({
        code: '23514',
        constraint: 'products_sku_format',
      });
    },
  );

  it.each(['', ' \t '])('rejects a blank product name: %j', async (name) => {
    await expect(insertProduct({ name })).rejects.toMatchObject({
      code: '23514',
      constraint: 'products_name_nonblank',
    });
  });

  it.each(['', ' \t '])('rejects a blank stock unit: %j', async (unit) => {
    await expect(insertProduct({ unit })).rejects.toMatchObject({
      code: '23514',
      constraint: 'products_unit_nonblank',
    });
  });

  it.each([
    { sku: 'A'.repeat(65) },
    { name: 'A'.repeat(161) },
    { unit: 'a'.repeat(33) },
    { description: 'a'.repeat(2001) },
  ])('enforces product field length limits (%#)', async (overrides) => {
    await expect(insertProduct(overrides)).rejects.toMatchObject({ code: '22001' });
  });

  it('rejects products without an organization', async () => {
    await expect(insertProduct({ organizationId: null })).rejects.toMatchObject({ code: '23502' });
  });

  it('rejects products referencing a missing organization', async () => {
    await expect(insertProduct({ organizationId: randomUUID() })).rejects.toMatchObject({
      code: '23503',
      constraint: 'products_organization_id_fkey',
    });
  });

  it('prevents deleting an organization that owns products', async () => {
    await insertProduct();
    await expect(
      client.query('DELETE FROM organizations WHERE id = $1', [organizationId]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'products_organization_id_fkey' });
  });
});
