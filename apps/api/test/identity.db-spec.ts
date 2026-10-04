import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';

describe('Identity database constraints', () => {
  let client: Client;
  let prisma: PrismaClient;
  let organizationId: string;
  let userId: string;
  let email: string;

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
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        connectionTimeoutMillis: 5000,
        statement_timeout: 5000,
        max: 1,
      }),
    });
    await client.connect();
  });

  beforeEach(async () => {
    organizationId = randomUUID();
    userId = randomUUID();
    email = `${userId}@example.test`;
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name, currency, updated_at) VALUES ($1, $2, $3, now())',
      [organizationId, 'Test Organization', 'USD'],
    );
    await client.query(
      'INSERT INTO users (id, email, display_name, updated_at) VALUES ($1, $2, $3, now())',
      [userId, email, 'Test User'],
    );
  });

  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  afterAll(async () => {
    await client?.end();
    await prisma?.$disconnect();
  });

  function insertMembership(
    roles: string[] | null,
    memberOrganization = organizationId,
    memberUser = userId,
  ) {
    return client.query(
      'INSERT INTO memberships (id, organization_id, user_id, roles, updated_at) VALUES ($1, $2, $3, $4::organization_role[], now())',
      [randomUUID(), memberOrganization, memberUser, roles],
    );
  }

  it('supports a user in multiple organizations with independent role sets through Prisma', async () => {
    const rollback = new Error('Rollback test transaction');
    const generatedUserId = randomUUID();

    await expect(
      prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            id: generatedUserId,
            email: `${generatedUserId}@example.test`,
            displayName: 'Prisma Test User',
          },
        });
        const first = await transaction.organization.create({
          data: { name: 'First Organization', currency: 'USD' },
        });
        const second = await transaction.organization.create({
          data: { name: 'Second Organization', currency: 'ETB' },
        });
        await transaction.membership.createMany({
          data: [
            { organizationId: first.id, userId: user.id, roles: ['ADMIN', 'PURCHASER'] },
            { organizationId: second.id, userId: user.id, roles: ['WAREHOUSE'] },
          ],
        });

        const memberships = await transaction.membership.findMany({
          where: { userId: user.id },
          include: { organization: true },
        });
        expect(memberships).toHaveLength(2);
        expect(
          memberships.find((membership) => membership.organizationId === first.id)?.roles,
        ).toEqual(['ADMIN', 'PURCHASER']);
        expect(
          memberships.find((membership) => membership.organizationId === second.id)?.roles,
        ).toEqual(['WAREHOUSE']);
        expect(user.createdAt).toBeInstanceOf(Date);
        expect(first.updatedAt).toBeInstanceOf(Date);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    expect(await prisma.user.findUnique({ where: { id: generatedUserId } })).toBeNull();
  });

  it('rejects duplicate normalized emails', async () => {
    await expect(
      client.query(
        'INSERT INTO users (id, email, display_name, updated_at) VALUES ($1, $2, $3, now())',
        [randomUUID(), email, 'Another User'],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'users_email_key' });
  });

  it.each([
    'MixedCase@example.test',
    ' user@example.test',
    'user@example.test ',
    'user @example.test',
    '',
  ])('rejects an unnormalized email: %j', async (invalidEmail) => {
    await expect(
      client.query('UPDATE users SET email = $1 WHERE id = $2', [invalidEmail, userId]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'users_email_normalized' });
  });

  it.each(['usd', 'US', '12A'])('rejects malformed currency: %s', async (currency) => {
    await expect(
      client.query('UPDATE organizations SET currency = $1 WHERE id = $2', [
        currency,
        organizationId,
      ]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'organizations_currency_format' });
  });

  it('rejects a blank organization name', async () => {
    await expect(
      client.query('UPDATE organizations SET name = $1 WHERE id = $2', [' \t ', organizationId]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'organizations_name_nonblank' });
  });
  it('archives and restores an organization through the timestamp column', async () => {
    const archived = new Date('2026-10-04T10:00:00.000Z');
    await expect(
      client.query('UPDATE organizations SET archived_at = $1 WHERE id = $2', [
        archived,
        organizationId,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
    const row = await client.query<{ archived_at: Date }>(
      'SELECT archived_at FROM organizations WHERE id = $1',
      [organizationId],
    );
    expect(row.rows[0].archived_at.toISOString()).toBe(archived.toISOString());
    await expect(
      client.query('UPDATE organizations SET archived_at = NULL WHERE id = $1', [organizationId]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('requires a normalized organization reply-to email when present', async () => {
    await expect(
      client.query('UPDATE organizations SET reply_to_email = $1 WHERE id = $2', [
        'orders@example.test',
        organizationId,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      client.query('UPDATE organizations SET reply_to_email = NULL WHERE id = $1', [
        organizationId,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
    for (const invalid of ['Orders@Example.test', 'orders @example.test', 'not-an-email', '']) {
      await client.query('SAVEPOINT reply_to_violation');
      await expect(
        client.query('UPDATE organizations SET reply_to_email = $1 WHERE id = $2', [
          invalid,
          organizationId,
        ]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'organizations_reply_to_email_normalized',
      });
      await client.query('ROLLBACK TO SAVEPOINT reply_to_violation');
    }
  });
  it('rejects a blank display name', async () => {
    await expect(
      client.query('UPDATE users SET display_name = $1 WHERE id = $2', [' \t ', userId]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'users_display_name_nonblank' });
  });

  it('allows all defined roles without a default privilege', async () => {
    await expect(
      insertMembership(['ADMIN', 'PURCHASER', 'MANAGER', 'WAREHOUSE']),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('rejects duplicate membership within an organization', async () => {
    await insertMembership(['MANAGER']);
    await expect(insertMembership(['WAREHOUSE'])).rejects.toMatchObject({
      code: '23505',
      constraint: 'memberships_organization_id_user_id_key',
    });
  });

  it('rejects a missing organization', async () => {
    await expect(insertMembership(['ADMIN'], randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint: 'memberships_organization_id_fkey',
    });
  });

  it('rejects a missing user', async () => {
    await expect(insertMembership(['ADMIN'], organizationId, randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint: 'memberships_user_id_fkey',
    });
  });

  it('rejects an empty role set', async () => {
    await expect(insertMembership([])).rejects.toMatchObject({
      code: '23514',
      constraint: 'memberships_roles_valid_set',
    });
  });

  it('rejects duplicate roles', async () => {
    await expect(insertMembership(['ADMIN', 'ADMIN'])).rejects.toMatchObject({
      code: '23514',
      constraint: 'memberships_roles_valid_set',
    });
  });

  it('rejects a null role set', async () => {
    await expect(insertMembership(null)).rejects.toMatchObject({ code: '23502' });
  });

  it('rejects a null entry in the role set', async () => {
    await expect(
      client.query(
        'INSERT INTO memberships (id, organization_id, user_id, roles, updated_at) VALUES ($1, $2, $3, ARRAY[NULL]::organization_role[], now())',
        [randomUUID(), organizationId, userId],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'memberships_roles_valid_set' });
  });

  it('rejects undefined role values', async () => {
    await expect(insertMembership(['OWNER'])).rejects.toMatchObject({ code: '22P02' });
  });

  it('prevents deleting an organization with memberships', async () => {
    await insertMembership(['ADMIN']);
    await expect(
      client.query('DELETE FROM organizations WHERE id = $1', [organizationId]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'memberships_organization_id_fkey' });
  });

  it('prevents deleting a user with memberships', async () => {
    await insertMembership(['ADMIN']);
    await expect(client.query('DELETE FROM users WHERE id = $1', [userId])).rejects.toMatchObject({
      code: '23503',
      constraint: 'memberships_user_id_fkey',
    });
  });
});
