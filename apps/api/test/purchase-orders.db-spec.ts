import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Purchase order and stock ledger constraints', () => {
  let client: Client;
  let organizationId: string;
  let userId: string;
  let supplierId: string;
  let locationId: string;
  let productId: string;
  let orderId: string;
  let savepoint = 0;

  async function expectViolation(run: () => Promise<unknown>, matcher: object) {
    const name = `expected_failure_${(savepoint += 1)}`;
    await client.query(`SAVEPOINT ${name}`);
    await expect(run()).rejects.toMatchObject(matcher);
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  beforeAll(async () => {
    config({ quiet: true });
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for database tests.');
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      options: '-c timezone=UTC',
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
    await client.connect();
  });

  beforeEach(async () => {
    organizationId = randomUUID();
    userId = randomUUID();
    supplierId = randomUUID();
    locationId = randomUUID();
    productId = randomUUID();
    orderId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Ledger Test Organization', 'USD'],
    );
    await client.query(
      'INSERT INTO users (id, email, display_name, updated_at) VALUES ($1, $2, $3, now())',
      [userId, `${userId}@example.test`, 'Ledger Test User'],
    );
    await client.query(
      'INSERT INTO suppliers (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [supplierId, organizationId, 'Ledger Supplier'],
    );
    await client.query(
      'INSERT INTO locations (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [locationId, organizationId, 'Ledger Warehouse'],
    );
    await client.query(
      'INSERT INTO products (id, organization_id, sku, name, unit, updated_at) VALUES ($1, $2, $3, $4, $5, now())',
      [productId, organizationId, 'LEDGER-01', 'Ledger Product', 'piece'],
    );
    await client.query(
      'INSERT INTO purchase_orders (id, organization_id, number, supplier_id, location_id, created_by_id, updated_at) VALUES ($1, $2, 1, $3, $4, $5, now())',
      [orderId, organizationId, supplierId, locationId, userId],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertLine(
    overrides: Partial<{
      orderId: string;
      organizationId: string;
      productId: string;
      quantity: number;
      unitPrice: string;
      received: number;
    }> = {},
  ) {
    const line = {
      orderId,
      organizationId,
      productId,
      quantity: 100,
      unitPrice: '25.50',
      received: 0,
      ...overrides,
    };
    return client
      .query(
        'INSERT INTO purchase_order_lines (id, organization_id, purchase_order_id, product_id, quantity, unit_price, received_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [
          randomUUID(),
          line.organizationId,
          line.orderId,
          line.productId,
          line.quantity,
          line.unitPrice,
          line.received,
        ],
      )
      .then((result) => result.rows[0].id as string);
  }

  it('numbers orders uniquely per organization', async () => {
    await expectViolation(
      () =>
        client.query(
          'INSERT INTO purchase_orders (id, organization_id, number, supplier_id, location_id, created_by_id, updated_at) VALUES ($1, $2, 1, $3, $4, $5, now())',
          [randomUUID(), organizationId, supplierId, locationId, userId],
        ),
      { code: '23505', constraint: 'purchase_orders_organization_id_number_key' },
    );
    const otherOrganization = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [otherOrganization, 'Second Ledger Organization', 'ETB'],
    );
    const otherSupplier = randomUUID();
    const otherLocation = randomUUID();
    await client.query(
      'INSERT INTO suppliers (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [otherSupplier, otherOrganization, 'Second Supplier'],
    );
    await client.query(
      'INSERT INTO locations (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [otherLocation, otherOrganization, 'Second Warehouse'],
    );
    await expect(
      client.query(
        'INSERT INTO purchase_orders (id, organization_id, number, supplier_id, location_id, created_by_id, updated_at) VALUES ($1, $2, 1, $3, $4, $5, now())',
        [randomUUID(), otherOrganization, otherSupplier, otherLocation, userId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('rejects orders whose supplier or location belongs to another organization', async () => {
    const otherOrganization = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [otherOrganization, 'Foreign Organization', 'ETB'],
    );
    const foreignSupplier = randomUUID();
    await client.query(
      'INSERT INTO suppliers (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [foreignSupplier, otherOrganization, 'Foreign Supplier'],
    );
    await expectViolation(
      () =>
        client.query(
          'INSERT INTO purchase_orders (id, organization_id, number, supplier_id, location_id, created_by_id, updated_at) VALUES ($1, $2, 2, $3, $4, $5, now())',
          [randomUUID(), organizationId, foreignSupplier, locationId, userId],
        ),
      { code: '23503', constraint: 'purchase_orders_organization_id_supplier_id_fkey' },
    );
  });

  it('rejects lines whose product belongs to another organization', async () => {
    const otherOrganization = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [otherOrganization, 'Foreign Product Organization', 'ETB'],
    );
    const foreignProduct = randomUUID();
    await client.query(
      'INSERT INTO products (id, organization_id, sku, name, unit, updated_at) VALUES ($1, $2, $3, $4, $5, now())',
      [foreignProduct, otherOrganization, 'FOREIGN-01', 'Foreign Product', 'piece'],
    );
    await expectViolation(() => insertLine({ productId: foreignProduct }), {
      code: '23503',
      constraint: 'purchase_order_lines_organization_id_product_id_fkey',
    });
  });

  it('rejects duplicate products, non-positive quantities, negative prices, and over-receipt on lines', async () => {
    await insertLine();
    await expectViolation(() => insertLine(), {
      code: '23505',
      constraint: 'purchase_order_lines_purchase_order_id_product_id_key',
    });
    await expectViolation(() => insertLine({ productId: randomUUID(), quantity: 0 }), {
      code: '23514',
      constraint: 'purchase_order_lines_quantity_positive',
    });
    await expectViolation(() => insertLine({ productId: randomUUID(), unitPrice: '-1.00' }), {
      code: '23514',
      constraint: 'purchase_order_lines_price_nonnegative',
    });
    await expectViolation(() => insertLine({ productId: randomUUID(), received: 101 }), {
      code: '23514',
      constraint: 'purchase_order_lines_received_bounds',
    });
  });

  it('links receipt lines to lines of the same purchase order only', async () => {
    const lineId = await insertLine();
    const otherOrder = randomUUID();
    await client.query(
      'INSERT INTO purchase_orders (id, organization_id, number, supplier_id, location_id, created_by_id, updated_at) VALUES ($1, $2, 2, $3, $4, $5, now())',
      [otherOrder, organizationId, supplierId, locationId, userId],
    );
    const receiptId = randomUUID();
    await client.query(
      'INSERT INTO goods_receipts (id, organization_id, purchase_order_id, received_by_id) VALUES ($1, $2, $3, $4)',
      [receiptId, organizationId, otherOrder, userId],
    );
    await expectViolation(
      () =>
        client.query(
          'INSERT INTO goods_receipt_lines (id, goods_receipt_id, purchase_order_id, purchase_order_line_id, quantity) VALUES ($1, $2, $3, $4, 10)',
          [randomUUID(), receiptId, otherOrder, lineId],
        ),
      { code: '23503' },
    );
  });

  it('requires receipt movements to be positive and tied to one receipt line each', async () => {
    const lineId = await insertLine();
    const receiptId = randomUUID();
    await client.query(
      'INSERT INTO goods_receipts (id, organization_id, purchase_order_id, received_by_id) VALUES ($1, $2, $3, $4)',
      [receiptId, organizationId, orderId, userId],
    );
    const receiptLineId = randomUUID();
    await client.query(
      'INSERT INTO goods_receipt_lines (id, goods_receipt_id, purchase_order_id, purchase_order_line_id, quantity) VALUES ($1, $2, $3, $4, 60)',
      [receiptLineId, receiptId, orderId, lineId],
    );

    const insertMovement = (quantity: number, movementReceiptLine: string | null) =>
      client.query(
        "INSERT INTO stock_movements (id, organization_id, product_id, location_id, type, quantity, goods_receipt_line_id, created_by_id) VALUES ($1, $2, $3, $4, 'RECEIPT', $5, $6, $7)",
        [
          randomUUID(),
          organizationId,
          productId,
          locationId,
          quantity,
          movementReceiptLine,
          userId,
        ],
      );

    await expectViolation(() => insertMovement(60, null), {
      code: '23514',
      constraint: 'stock_movements_receipt_shape',
    });
    await expectViolation(() => insertMovement(-5, receiptLineId), {
      code: '23514',
    });
    await expect(insertMovement(60, receiptLineId)).resolves.toMatchObject({ rowCount: 1 });
    await expectViolation(() => insertMovement(1, receiptLineId), {
      code: '23505',
      constraint: 'stock_movements_goods_receipt_line_id_key',
    });
  });

  it('never allows negative stock levels', async () => {
    await expect(
      client.query(
        'INSERT INTO stock_levels (organization_id, product_id, location_id, quantity, updated_at) VALUES ($1, $2, $3, 5, now())',
        [organizationId, productId, locationId],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expectViolation(
      () =>
        client.query(
          'UPDATE stock_levels SET quantity = quantity - 6 WHERE organization_id = $1 AND product_id = $2 AND location_id = $3',
          [organizationId, productId, locationId],
        ),
      { code: '23514', constraint: 'stock_levels_never_negative' },
    );
  });

  it('preserves audit history by restricting deletes', async () => {
    const lineId = await insertLine();
    const receiptId = randomUUID();
    await client.query(
      'INSERT INTO goods_receipts (id, organization_id, purchase_order_id, received_by_id) VALUES ($1, $2, $3, $4)',
      [receiptId, organizationId, orderId, userId],
    );
    await client.query(
      'INSERT INTO goods_receipt_lines (id, goods_receipt_id, purchase_order_id, purchase_order_line_id, quantity) VALUES ($1, $2, $3, $4, 40)',
      [randomUUID(), receiptId, orderId, lineId],
    );
    await expectViolation(
      () => client.query('DELETE FROM purchase_orders WHERE id = $1', [orderId]),
      { code: '23503' },
    );
    await expectViolation(() => client.query('DELETE FROM users WHERE id = $1', [userId]), {
      code: '23503',
    });
    await expectViolation(() => client.query('DELETE FROM products WHERE id = $1', [productId]), {
      code: '23503',
    });
  });
});
