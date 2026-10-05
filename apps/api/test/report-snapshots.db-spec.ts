import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Report snapshot database constraints', () => {
  let client: Client;
  let organizationId: string;
  let userId: string;

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
    userId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Snapshot Test Organization', 'USD'],
    );
    await client.query(
      'INSERT INTO users (id, email, display_name, updated_at) VALUES ($1, $2, $3, now())',
      [userId, `${userId}@example.test`, 'Snapshot User'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertSnapshot(type = 'valuation', createdBy: string | null = null) {
    return client.query(
      'INSERT INTO report_snapshots (id, organization_id, type, payload, created_by) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id, created_at',
      [
        randomUUID(),
        organizationId,
        type,
        '{"currency":"USD","total":"10.00","items":[]}',
        createdBy,
      ],
    );
  }

  it('stores an immutable valuation payload with a creation time', async () => {
    const result = await insertSnapshot('valuation', userId);
    expect(result.rows[0].created_at).toBeInstanceOf(Date);
  });

  it('rejects unknown report types', async () => {
    await expect(insertSnapshot('profit')).rejects.toMatchObject({
      code: '23514',
      constraint: 'report_snapshots_type_known',
    });
  });

  it('requires an existing organization', async () => {
    await expect(
      client.query(
        'INSERT INTO report_snapshots (id, organization_id, type, payload) VALUES ($1, $2, $3, $4::jsonb)',
        [randomUUID(), randomUUID(), 'valuation', '{}'],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'report_snapshots_organization_id_fkey',
    });
  });

  it('keeps snapshots when their creator account is deleted', async () => {
    const seeded = await insertSnapshot('valuation', userId);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    const row = await client.query<{ created_by: string | null }>(
      'SELECT created_by FROM report_snapshots WHERE id = $1',
      [seeded.rows[0].id],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].created_by).toBeNull();
  });
});
