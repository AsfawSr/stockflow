import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Stock transfer and adjustment constraints', () => {
  let client: Client;
  let organizationId: string;
  let userId: string;
  let productId: string;
  let mainLocationId: string;
  let storeLocationId: string;
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
    productId = randomUUID();
    mainLocationId = randomUUID();
    storeLocationId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Stock Test Organization', 'USD'],
    );
    await client.query(
      'INSERT INTO users (id, email, display_name, updated_at) VALUES ($1, $2, $3, now())',
      [userId, `${userId}@example.test`, 'Stock Test User'],
    );
    await client.query(
      'INSERT INTO products (id, organization_id, sku, name, unit, updated_at) VALUES ($1, $2, $3, $4, $5, now())',
      [productId, organizationId, 'STOCK-01', 'Stock Product', 'piece'],
    );
    for (const [id, name] of [
      [mainLocationId, 'Main Warehouse'],
      [storeLocationId, 'Retail Store'],
    ] as const) {
      await client.query(
        'INSERT INTO locations (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
        [id, organizationId, name],
      );
    }
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertTransfer(
    overrides: Partial<{ from: string; to: string; quantity: number; note: string | null }> = {},
  ) {
    const transfer = {
      from: mainLocationId,
      to: storeLocationId,
      quantity: 5,
      note: null,
      ...overrides,
    };
    return client
      .query(
        'INSERT INTO stock_transfers (id, organization_id, product_id, from_location_id, to_location_id, quantity, note, created_by_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [
          randomUUID(),
          organizationId,
          productId,
          transfer.from,
          transfer.to,
          transfer.quantity,
          transfer.note,
          userId,
        ],
      )
      .then((result) => result.rows[0].id as string);
  }

  function insertAdjustment(quantity: number, reason: string) {
    return client
      .query(
        'INSERT INTO stock_adjustments (id, organization_id, product_id, location_id, quantity, reason, created_by_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [randomUUID(), organizationId, productId, mainLocationId, quantity, reason, userId],
      )
      .then((result) => result.rows[0].id as string);
  }

  function insertMovement(fields: {
    type: string;
    quantity: number;
    locationId?: string;
    transferId?: string | null;
    adjustmentId?: string | null;
  }) {
    return client.query(
      'INSERT INTO stock_movements (id, organization_id, product_id, location_id, type, quantity, stock_transfer_id, stock_adjustment_id, created_by_id) VALUES ($1, $2, $3, $4, $5::stock_movement_type, $6, $7, $8, $9)',
      [
        randomUUID(),
        organizationId,
        productId,
        fields.locationId ?? mainLocationId,
        fields.type,
        fields.quantity,
        fields.transferId ?? null,
        fields.adjustmentId ?? null,
        userId,
      ],
    );
  }

  it('rejects transfers to the same location, non-positive quantities, and blank notes', async () => {
    await expectViolation(() => insertTransfer({ to: mainLocationId }), {
      code: '23514',
      constraint: 'stock_transfers_distinct_locations',
    });
    await expectViolation(() => insertTransfer({ quantity: 0 }), {
      code: '23514',
      constraint: 'stock_transfers_quantity_positive',
    });
    await expectViolation(() => insertTransfer({ note: '  ' }), {
      code: '23514',
      constraint: 'stock_transfers_note_nonblank',
    });
  });

  it('rejects zero-quantity adjustments and blank reasons', async () => {
    await expectViolation(() => insertAdjustment(0, 'Count correction'), {
      code: '23514',
      constraint: 'stock_adjustments_quantity_nonzero',
    });
    await expectViolation(() => insertAdjustment(-1, ' \t '), {
      code: '23514',
      constraint: 'stock_adjustments_reason_nonblank',
    });
    await expect(insertAdjustment(-2, 'Damaged in storage')).resolves.toBeDefined();
  });

  it('forces transfer movements to link a transfer with correct signs and one per direction', async () => {
    const transferId = await insertTransfer();
    await expectViolation(() => insertMovement({ type: 'TRANSFER_OUT', quantity: -5 }), {
      code: '23514',
      constraint: 'stock_movements_transfer_shape',
    });
    await expectViolation(() => insertMovement({ type: 'TRANSFER_OUT', quantity: 5, transferId }), {
      code: '23514',
      constraint: 'stock_movements_transfer_shape',
    });
    await expectViolation(() => insertMovement({ type: 'TRANSFER_IN', quantity: -5, transferId }), {
      code: '23514',
      constraint: 'stock_movements_transfer_shape',
    });
    await expect(
      insertMovement({ type: 'TRANSFER_OUT', quantity: -5, transferId }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      insertMovement({
        type: 'TRANSFER_IN',
        quantity: 5,
        locationId: storeLocationId,
        transferId,
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expectViolation(
      () =>
        insertMovement({
          type: 'TRANSFER_IN',
          quantity: 1,
          locationId: storeLocationId,
          transferId,
        }),
      { code: '23505', constraint: 'stock_movements_transfer_direction_key' },
    );
  });

  it('forces adjustment movements to link exactly one adjustment', async () => {
    const adjustmentId = await insertAdjustment(-2, 'Damaged in storage');
    await expectViolation(() => insertMovement({ type: 'ADJUSTMENT', quantity: -2 }), {
      code: '23514',
      constraint: 'stock_movements_adjustment_shape',
    });
    await expectViolation(() => insertMovement({ type: 'RECEIPT', quantity: 2, adjustmentId }), {
      code: '23514',
    });
    await expect(
      insertMovement({ type: 'ADJUSTMENT', quantity: -2, adjustmentId }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expectViolation(
      () => insertMovement({ type: 'ADJUSTMENT', quantity: -2, adjustmentId }),
      { code: '23505', constraint: 'stock_movements_stock_adjustment_id_key' },
    );
  });

  it('rejects transfers referencing another organization and preserves history on delete', async () => {
    const otherOrganization = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [otherOrganization, 'Foreign Stock Organization', 'ETB'],
    );
    const foreignLocation = randomUUID();
    await client.query(
      'INSERT INTO locations (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [foreignLocation, otherOrganization, 'Foreign Warehouse'],
    );
    await expectViolation(() => insertTransfer({ to: foreignLocation }), {
      code: '23503',
      constraint: 'stock_transfers_organization_id_to_location_id_fkey',
    });
    const transferId = await insertTransfer();
    await insertMovement({ type: 'TRANSFER_OUT', quantity: -5, transferId });
    await expectViolation(
      () => client.query('DELETE FROM stock_transfers WHERE id = $1', [transferId]),
      { code: '23503' },
    );
  });
});
