import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Supplier and location database constraints', () => {
  let client: Client;
  let organizationId: string;
  let savepoint = 0;

  // PostgreSQL aborts the transaction on constraint errors; savepoints keep each test usable.
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
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Partner Test Organization', 'USD'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertSupplier(
    overrides: Partial<{
      organizationId: string;
      name: string;
      contactName: string | null;
      email: string | null;
      phone: string | null;
      address: string | null;
    }> = {},
  ) {
    const supplier = {
      organizationId,
      name: 'Nile Electronics',
      contactName: null,
      email: null,
      phone: null,
      address: null,
      ...overrides,
    };
    return client.query(
      'INSERT INTO suppliers (id, organization_id, name, contact_name, email, phone, address, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id',
      [
        randomUUID(),
        supplier.organizationId,
        supplier.name,
        supplier.contactName,
        supplier.email,
        supplier.phone,
        supplier.address,
      ],
    );
  }

  function insertLocation(
    overrides: Partial<{ organizationId: string; name: string; address: string | null }> = {},
  ) {
    const location = { organizationId, name: 'Main Warehouse', address: null, ...overrides };
    return client.query(
      'INSERT INTO locations (id, organization_id, name, address, updated_at) VALUES ($1, $2, $3, $4, now()) RETURNING id',
      [randomUUID(), location.organizationId, location.name, location.address],
    );
  }

  it('accepts complete supplier and location records', async () => {
    await expect(
      insertSupplier({
        contactName: 'Sara Bekele',
        email: 'sales@nile.test',
        phone: '+251 (11) 555-0100',
        address: 'Bole Road, Addis Ababa',
      }),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(insertLocation({ address: 'Industrial Zone 4' })).resolves.toMatchObject({
      rowCount: 1,
    });
  });

  it.each(['suppliers', 'locations'] as const)(
    'rejects duplicate %s names within one organization but allows them across organizations',
    async (table) => {
      const insert = table === 'suppliers' ? insertSupplier : insertLocation;
      await insert();
      await expectViolation(() => insert(), {
        code: '23505',
        constraint: `${table}_organization_id_name_key`,
      });
      const otherId = randomUUID();
      await client.query(
        'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
        [otherId, 'Second Partner Organization', 'ETB'],
      );
      await expect(insert({ organizationId: otherId })).resolves.toMatchObject({ rowCount: 1 });
    },
  );

  it('keeps archived names reserved', async () => {
    const created = await insertSupplier();
    await client.query('UPDATE suppliers SET archived_at = now() WHERE id = $1', [
      created.rows[0].id,
    ]);
    await expectViolation(() => insertSupplier(), { code: '23505' });
  });

  it.each(['', ' \t '])('rejects a blank supplier name: %j', async (name) => {
    await expectViolation(() => insertSupplier({ name }), {
      code: '23514',
      constraint: 'suppliers_name_nonblank',
    });
  });

  it.each(['', ' \t '])('rejects a blank location name: %j', async (name) => {
    await expectViolation(() => insertLocation({ name }), {
      code: '23514',
      constraint: 'locations_name_nonblank',
    });
  });

  it.each(['Sales@nile.test', ' sales@nile.test', 'sales @nile.test', ''])(
    'rejects an unnormalized supplier email: %j',
    async (email) => {
      await expectViolation(() => insertSupplier({ email }), {
        code: '23514',
        constraint: 'suppliers_email_normalized',
      });
    },
  );

  it.each(['12', 'call me', '++', '   ', 'phone: 555'])(
    'rejects a malformed supplier phone: %j',
    async (phone) => {
      await expectViolation(() => insertSupplier({ phone }), {
        code: '23514',
        constraint: 'suppliers_phone_format',
      });
    },
  );

  it('rejects whitespace-only optional fields', async () => {
    await expectViolation(() => insertSupplier({ contactName: ' \t ' }), {
      code: '23514',
      constraint: 'suppliers_contact_name_nonblank',
    });
    await expectViolation(() => insertSupplier({ address: '  ' }), {
      code: '23514',
      constraint: 'suppliers_address_nonblank',
    });
    await expectViolation(() => insertLocation({ address: '  ' }), {
      code: '23514',
      constraint: 'locations_address_nonblank',
    });
  });

  it('enforces field length limits', async () => {
    await expectViolation(() => insertSupplier({ name: 'A'.repeat(161) }), { code: '22001' });
    await expectViolation(() => insertSupplier({ phone: '0'.repeat(33) }), { code: '22001' });
    await expectViolation(() => insertLocation({ name: 'A'.repeat(121) }), { code: '22001' });
    await expectViolation(() => insertLocation({ address: 'a'.repeat(501) }), { code: '22001' });
  });

  it('rejects records referencing a missing organization', async () => {
    await expectViolation(() => insertSupplier({ organizationId: randomUUID() }), {
      code: '23503',
      constraint: 'suppliers_organization_id_fkey',
    });
    await expectViolation(() => insertLocation({ organizationId: randomUUID() }), {
      code: '23503',
      constraint: 'locations_organization_id_fkey',
    });
  });

  it('prevents deleting an organization that owns suppliers or locations', async () => {
    await insertSupplier();
    await expectViolation(
      () => client.query('DELETE FROM organizations WHERE id = $1', [organizationId]),
      { code: '23503' },
    );
  });
});
