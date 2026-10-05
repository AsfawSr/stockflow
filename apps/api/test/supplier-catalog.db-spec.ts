import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Supplier catalog price database constraints', () => {
  let client: Client;
  let organizationId: string;
  let supplierId: string;
  let productId: string;

  beforeAll(async () => {
    config({ quiet: true });
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for database integration tests.');
    }
    client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
    await client.connect();
  });

  beforeEach(async () => {
    organizationId = randomUUID();
    supplierId = randomUUID();
    productId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Catalog Test Organization', 'USD'],
    );
    await client.query(
      'INSERT INTO suppliers (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [supplierId, organizationId, 'Catalog Supplier'],
    );
    await client.query(
      'INSERT INTO products (id, organization_id, sku, name, unit, updated_at) VALUES ($1, $2, $3, $4, $5, now())',
      [productId, organizationId, 'CAT-1', 'Cataloged Widget', 'piece'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertPrice(price: string, supplier = supplierId, product = productId) {
    return client.query(
      'INSERT INTO supplier_catalog_prices (id, organization_id, supplier_id, product_id, unit_price, updated_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id, unit_price',
      [randomUUID(), organizationId, supplier, product, price],
    );
  }

  it('stores one quoted price per supplier and product', async () => {
    const result = await insertPrice('12.50');
    expect(result.rows[0].unit_price).toBe('12.50');
    await expect(insertPrice('13.00')).rejects.toMatchObject({
      code: '23505',
      constraint: 'supplier_catalog_prices_supplier_id_product_id_key',
    });
  });

  it.each(['0.00', '-1.00'])('rejects a non-positive price: %s', async (price) => {
    await client.query('SAVEPOINT price_violation');
    await expect(insertPrice(price)).rejects.toMatchObject({
      code: '23514',
      constraint: 'supplier_catalog_prices_price_positive',
    });
    await client.query('ROLLBACK TO SAVEPOINT price_violation');
  });

  it('requires existing suppliers and products', async () => {
    await client.query('SAVEPOINT fk_violation');
    await expect(insertPrice('5.00', randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint: 'supplier_catalog_prices_supplier_id_fkey',
    });
    await client.query('ROLLBACK TO SAVEPOINT fk_violation');
    await expect(insertPrice('5.00', supplierId, randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint: 'supplier_catalog_prices_product_id_fkey',
    });
  });

  it('removes catalog entries with their supplier or product', async () => {
    const seeded = await insertPrice('9.99');
    await client.query('DELETE FROM suppliers WHERE id = $1', [supplierId]);
    const afterSupplier = await client.query(
      'SELECT 1 FROM supplier_catalog_prices WHERE id = $1',
      [seeded.rows[0].id],
    );
    expect(afterSupplier.rowCount).toBe(0);

    await client.query(
      'INSERT INTO suppliers (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [supplierId, organizationId, 'Catalog Supplier'],
    );
    const reseeded = await insertPrice('9.99');
    await client.query('DELETE FROM products WHERE id = $1', [productId]);
    const afterProduct = await client.query('SELECT 1 FROM supplier_catalog_prices WHERE id = $1', [
      reseeded.rows[0].id,
    ]);
    expect(afterProduct.rowCount).toBe(0);
  });
});
