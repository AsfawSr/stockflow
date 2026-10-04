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
      'INSERT INTO webhook_endpoints (id, organization_id, url, secret, updated_at) VALUES ($1, $2, $3, $4, now()) RETURNING active, created_at',
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
});
