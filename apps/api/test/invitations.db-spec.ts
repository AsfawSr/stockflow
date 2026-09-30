import { createHash, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { Client } from 'pg';

describe('Invitation constraints', () => {
  let client: Client;
  let organizationId: string;
  let userId: string;
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
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Invitation Test Organization', 'USD'],
    );
    await client.query(
      'INSERT INTO users (id, email, display_name, updated_at) VALUES ($1, $2, $3, now())',
      [userId, `${userId}@example.test`, 'Invitation Test Admin'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
  });

  function insertInvitation(
    overrides: Partial<{
      email: string;
      roles: string[];
      tokenHash: string;
      expiresAt: string;
    }> = {},
  ) {
    const invitation = {
      email: 'invitee@example.test',
      roles: ['WAREHOUSE'],
      tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      expiresAt: "now() + interval '7 days'",
      ...overrides,
    };
    return client.query(
      `INSERT INTO invitations (id, organization_id, email, roles, token_hash, invited_by_id, expires_at)
       VALUES ($1, $2, $3, $4::organization_role[], $5, $6, ${invitation.expiresAt})`,
      [
        randomUUID(),
        organizationId,
        invitation.email,
        invitation.roles,
        invitation.tokenHash,
        userId,
      ],
    );
  }

  it('requires normalized email, a real hash, future expiry, and a valid role set', async () => {
    await expectViolation(() => insertInvitation({ email: 'Invitee@Example.test' }), {
      constraint: 'invitations_email_normalized',
    });
    await expectViolation(() => insertInvitation({ email: '' }), {
      constraint: 'invitations_email_normalized',
    });
    await expectViolation(() => insertInvitation({ tokenHash: 'not-a-hash' }), {
      constraint: 'invitations_hash_format',
    });
    await expectViolation(() => insertInvitation({ expiresAt: "now() - interval '1 hour'" }), {
      constraint: 'invitations_expiry',
    });
    await expectViolation(() => insertInvitation({ roles: [] }), {
      constraint: 'invitations_roles_valid_set',
    });
    await expectViolation(() => insertInvitation({ roles: ['ADMIN', 'ADMIN'] }), {
      constraint: 'invitations_roles_valid_set',
    });
    await insertInvitation({ roles: ['ADMIN', 'MANAGER'] });
  });

  it('allows one invitation per email per organization and unique tokens', async () => {
    const tokenHash = createHash('sha256').update('fixed token').digest('hex');
    await insertInvitation({ tokenHash });
    await expectViolation(() => insertInvitation(), {
      constraint: 'invitations_organization_id_email_key',
    });
    const otherOrganization = randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [otherOrganization, 'Second Invitation Organization', 'USD'],
    );
    await expectViolation(
      () =>
        client.query(
          `INSERT INTO invitations (id, organization_id, email, roles, token_hash, invited_by_id, expires_at)
           VALUES ($1, $2, $3, $4::organization_role[], $5, $6, now() + interval '7 days')`,
          [randomUUID(), otherOrganization, 'other@example.test', ['ADMIN'], tokenHash, userId],
        ),
      { constraint: 'invitations_token_hash_key' },
    );
  });

  it('keeps referenced organizations and inviters undeletable', async () => {
    await insertInvitation();
    await expectViolation(
      () => client.query('DELETE FROM organizations WHERE id = $1', [organizationId]),
      {
        constraint: 'invitations_organization_id_fkey',
      },
    );
    await expectViolation(() => client.query('DELETE FROM users WHERE id = $1', [userId]), {
      constraint: 'invitations_invited_by_id_fkey',
    });
  });
});
