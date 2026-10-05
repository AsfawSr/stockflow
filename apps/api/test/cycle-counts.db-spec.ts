import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Cycle count database constraints', () => {
  let client: Client;
  let organizationId: string;
  let locationId: string;
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
    locationId = randomUUID();
    productId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Count Test Organization', 'USD'],
    );
    await client.query(
      'INSERT INTO locations (id, organization_id, name, updated_at) VALUES ($1, $2, $3, now())',
      [locationId, organizationId, 'Count Warehouse'],
    );
    await client.query(
      'INSERT INTO products (id, organization_id, sku, name, unit, updated_at) VALUES ($1, $2, $3, $4, $5, now())',
      [productId, organizationId, 'COUNT-1', 'Counted Widget', 'piece'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertCount(overrides: Record<string, unknown> = {}) {
    const values = { status: 'OPEN', note: null, completedAt: null, ...overrides };
    return client.query(
      'INSERT INTO cycle_counts (id, organization_id, location_id, status, note, completed_at, updated_at) VALUES ($1, $2, $3, $4::cycle_count_status, $5, $6, now()) RETURNING id, status',
      [randomUUID(), organizationId, locationId, values.status, values.note, values.completedAt],
    );
  }

  function insertLine(cycleCountId: string, expected: number, counted: number) {
    return client.query(
      'INSERT INTO cycle_count_lines (id, cycle_count_id, organization_id, product_id, expected_quantity, counted_quantity, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id',
      [randomUUID(), cycleCountId, organizationId, productId, expected, counted],
    );
  }

  it('opens a count with the OPEN status by default', async () => {
    const result = await client.query(
      'INSERT INTO cycle_counts (id, organization_id, location_id, updated_at) VALUES ($1, $2, $3, now()) RETURNING status',
      [randomUUID(), organizationId, locationId],
    );
    expect(result.rows[0].status).toBe('OPEN');
  });

  it('requires a completion time once completed and rejects unknown statuses', async () => {
    await client.query('SAVEPOINT status_violation');
    await expect(insertCount({ status: 'COMPLETED' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'cycle_counts_completed_has_time',
    });
    await client.query('ROLLBACK TO SAVEPOINT status_violation');
    await expect(
      insertCount({ status: 'COMPLETED', completedAt: new Date() }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await client.query('SAVEPOINT status_violation');
    await expect(insertCount({ status: 'TALLIED' })).rejects.toMatchObject({ code: '22P02' });
    await client.query('ROLLBACK TO SAVEPOINT status_violation');
    await expect(insertCount({ note: ' \t ' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'cycle_counts_note_nonblank',
    });
  });

  it('keeps one line per product with non-negative quantities', async () => {
    const count = await insertCount();
    const countId = count.rows[0].id as string;
    await expect(insertLine(countId, 5, 3)).resolves.toMatchObject({ rowCount: 1 });
    await client.query('SAVEPOINT line_violation');
    await expect(insertLine(countId, 5, 4)).rejects.toMatchObject({
      code: '23505',
      constraint: 'cycle_count_lines_cycle_count_id_product_id_key',
    });
    await client.query('ROLLBACK TO SAVEPOINT line_violation');
    await client.query('SAVEPOINT line_violation');
    await expect(insertLine(randomUUID(), 5, 3)).rejects.toMatchObject({
      code: '23503',
      constraint: 'cycle_count_lines_cycle_count_id_fkey',
    });
    await client.query('ROLLBACK TO SAVEPOINT line_violation');
    const second = await insertCount();
    await client.query('SAVEPOINT line_violation');
    await expect(insertLine(second.rows[0].id as string, -1, 3)).rejects.toMatchObject({
      code: '23514',
      constraint: 'cycle_count_lines_expected_nonnegative',
    });
    await client.query('ROLLBACK TO SAVEPOINT line_violation');
    await expect(insertLine(second.rows[0].id as string, 1, -3)).rejects.toMatchObject({
      code: '23514',
      constraint: 'cycle_count_lines_counted_nonnegative',
    });
  });

  it('removes lines with their count but never with their location', async () => {
    const count = await insertCount();
    const countId = count.rows[0].id as string;
    const line = await insertLine(countId, 2, 2);
    await client.query('DELETE FROM cycle_counts WHERE id = $1', [countId]);
    const remaining = await client.query('SELECT 1 FROM cycle_count_lines WHERE id = $1', [
      line.rows[0].id,
    ]);
    expect(remaining.rowCount).toBe(0);

    await insertCount();
    await expect(
      client.query('DELETE FROM locations WHERE id = $1', [locationId]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'cycle_counts_location_id_fkey' });
  });
});
