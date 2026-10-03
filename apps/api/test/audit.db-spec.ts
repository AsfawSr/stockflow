import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Audit event database constraints', () => {
  let client: Client;
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
    await client.connect();
  });

  beforeEach(async () => {
    organizationId = randomUUID();
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Audit Test Organization', 'USD'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });
  afterAll(async () => {
    await client?.end();
  });

  function insertEvent(
    overrides: Partial<{
      organizationId: string;
      actorId: string | null;
      action: string;
      entityType: string;
      entityId: string | null;
      summary: string;
    }> = {},
  ) {
    const event = {
      organizationId,
      actorId: null,
      action: 'order.approved',
      entityType: 'purchase_order',
      entityId: null,
      summary: 'Approved purchase order PO-0001',
      ...overrides,
    };
    return client.query(
      'INSERT INTO audit_events (id, organization_id, actor_id, action, entity_type, entity_id, summary) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at',
      [
        randomUUID(),
        event.organizationId,
        event.actorId,
        event.action,
        event.entityType,
        event.entityId,
        event.summary,
      ],
    );
  }

  async function expectViolation(code: string, run: () => Promise<unknown>) {
    await client.query('SAVEPOINT violation');
    await expect(run()).rejects.toMatchObject({ code });
    await client.query('ROLLBACK TO SAVEPOINT violation');
  }

  it('requires non-blank action, entity type, and summary', async () => {
    await expectViolation('23514', () => insertEvent({ action: '   ' }));
    await expectViolation('23514', () => insertEvent({ entityType: '   ' }));
    await expectViolation('23514', () => insertEvent({ summary: '   ' }));
    await expect(insertEvent()).resolves.toMatchObject({ rowCount: 1 });
  });

  it('requires an existing organization and keeps history when one is referenced', async () => {
    await expectViolation('23503', () => insertEvent({ organizationId: randomUUID() }));
    await insertEvent();
    await expectViolation('23503', () =>
      client.query('DELETE FROM organizations WHERE id = $1', [organizationId]),
    );
  });

  it('detaches the actor on user deletion without losing the event', async () => {
    const actorId = randomUUID();
    await client.query(
      'INSERT INTO users (id, email, display_name, updated_at) VALUES ($1, $2, $3, now())',
      [actorId, `${randomUUID()}@example.test`, 'Audit Actor'],
    );
    const inserted = await insertEvent({ actorId });
    await client.query('DELETE FROM users WHERE id = $1', [actorId]);
    const event = await client.query<{ actor_id: string | null; summary: string }>(
      'SELECT actor_id, summary FROM audit_events WHERE id = $1',
      [inserted.rows[0].id],
    );
    expect(event.rows[0]).toEqual({
      actor_id: null,
      summary: 'Approved purchase order PO-0001',
    });
  });

  it('scopes events to their organization and lists newest first', async () => {
    const otherId = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [otherId, 'Other Audit Organization', 'USD'],
    );
    await client.query(
      "INSERT INTO audit_events (id, organization_id, action, entity_type, summary, created_at) VALUES ($1, $2, 'order.created', 'purchase_order', 'Created purchase order PO-0001', now() - interval '2 minutes')",
      [randomUUID(), organizationId],
    );
    await client.query(
      "INSERT INTO audit_events (id, organization_id, action, entity_type, summary, created_at) VALUES ($1, $2, 'order.submitted', 'purchase_order', 'Submitted purchase order PO-0001', now() - interval '1 minute')",
      [randomUUID(), organizationId],
    );
    await insertEvent({ organizationId: otherId, summary: 'Approved elsewhere' });
    const events = await client.query<{ summary: string }>(
      'SELECT summary FROM audit_events WHERE organization_id = $1 ORDER BY created_at DESC, id DESC',
      [organizationId],
    );
    expect(events.rows.map((row) => row.summary)).toEqual([
      'Submitted purchase order PO-0001',
      'Created purchase order PO-0001',
    ]);
  });
});
