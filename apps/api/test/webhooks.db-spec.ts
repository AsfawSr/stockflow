import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Webhook endpoint database constraints', () => {
  let client: Client;
  let organizationId: string;

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
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Webhook Test Organization', 'USD'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertEndpoint(url: string, secret = 'a-sufficiently-random-secret') {
    return client.query(
      'INSERT INTO webhook_endpoints (id, organization_id, url, secret, updated_at) VALUES ($1, $2, $3, $4, now()) RETURNING id, active, created_at',
      [randomUUID(), organizationId, url, secret],
    );
  }

  it('stores an endpoint as active by default', async () => {
    const result = await insertEndpoint('https://example.test/hooks/stockflow');
    expect(result.rows[0].active).toBe(true);
    expect(result.rows[0].created_at).toBeInstanceOf(Date);
  });

  it.each([
    'ftp://example.test/hooks',
    'example.test/hooks',
    'https://example.test/with space',
    'https://',
    '',
    ' ',
  ])('rejects a malformed url: %j', async (url) => {
    await client.query('SAVEPOINT url_violation');
    await expect(insertEndpoint(url)).rejects.toMatchObject({
      code: '23514',
      constraint: 'webhook_endpoints_url_format',
    });
    await client.query('ROLLBACK TO SAVEPOINT url_violation');
  });

  it('rejects a blank secret', async () => {
    await expect(
      insertEndpoint('https://example.test/hooks/stockflow', ' \t '),
    ).rejects.toMatchObject({ code: '23514', constraint: 'webhook_endpoints_secret_nonblank' });
  });

  it('requires an existing organization', async () => {
    await expect(
      client.query(
        'INSERT INTO webhook_endpoints (id, organization_id, url, secret, updated_at) VALUES ($1, $2, $3, $4, now())',
        [randomUUID(), randomUUID(), 'https://example.test/hooks', 'a-secret-value'],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'webhook_endpoints_organization_id_fkey',
    });
  });

  async function insertDelivery(overrides: Record<string, unknown> = {}) {
    const endpoint = await insertEndpoint('https://example.test/hooks/deliveries');
    const values = {
      endpointId: endpoint.rows[0].id as string,
      event: 'order.submitted',
      body: '{"event":"order.submitted"}',
      status: 'PENDING',
      nextAttemptAt: new Date(),
      ...overrides,
    };
    return client.query(
      'INSERT INTO webhook_deliveries (id, webhook_endpoint_id, organization_id, event, body, status, next_attempt_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::webhook_delivery_status, $7, now()) RETURNING id, status, attempts',
      [
        randomUUID(),
        values.endpointId,
        organizationId,
        values.event,
        values.body,
        values.status,
        values.nextAttemptAt,
      ],
    );
  }

  it('stores a pending delivery with zero attempts by default', async () => {
    const result = await insertDelivery();
    expect(result.rows[0].status).toBe('PENDING');
    expect(result.rows[0].attempts).toBe(0);
  });

  it('requires a due time while a delivery is pending', async () => {
    await client.query('SAVEPOINT due_time_violation');
    await expect(insertDelivery({ nextAttemptAt: null })).rejects.toMatchObject({
      code: '23514',
      constraint: 'webhook_deliveries_pending_has_due_time',
    });
    await client.query('ROLLBACK TO SAVEPOINT due_time_violation');
    await expect(
      insertDelivery({ status: 'SUCCEEDED', nextAttemptAt: null }),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('rejects unknown statuses, blank fields, and negative attempts', async () => {
    const seeded = await insertDelivery();
    const deliveryId = seeded.rows[0].id as string;
    await client.query('SAVEPOINT delivery_violation');
    await expect(insertDelivery({ status: 'RETRYING' })).rejects.toMatchObject({ code: '22P02' });
    await client.query('ROLLBACK TO SAVEPOINT delivery_violation');
    await client.query('SAVEPOINT delivery_violation');
    await expect(insertDelivery({ event: ' \t ' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'webhook_deliveries_event_nonblank',
    });
    await client.query('ROLLBACK TO SAVEPOINT delivery_violation');
    await client.query('SAVEPOINT delivery_violation');
    await expect(insertDelivery({ body: ' ' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'webhook_deliveries_body_nonblank',
    });
    await client.query('ROLLBACK TO SAVEPOINT delivery_violation');
    await client.query('SAVEPOINT delivery_violation');
    await expect(
      client.query('UPDATE webhook_deliveries SET attempts = -1 WHERE id = $1', [deliveryId]),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'webhook_deliveries_attempts_nonnegative',
    });
    await client.query('ROLLBACK TO SAVEPOINT delivery_violation');
  });

  it('removes deliveries when their endpoint is deleted', async () => {
    const seeded = await insertDelivery();
    const deliveryId = seeded.rows[0].id as string;
    await client.query('DELETE FROM webhook_endpoints WHERE organization_id = $1 AND url = $2', [
      organizationId,
      'https://example.test/hooks/deliveries',
    ]);
    const remaining = await client.query('SELECT 1 FROM webhook_deliveries WHERE id = $1', [
      deliveryId,
    ]);
    expect(remaining.rowCount).toBe(0);
  });
});
