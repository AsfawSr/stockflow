import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { verify } from 'argon2';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Authentication and authorization against PostgreSQL', () => {
  let prisma: PrismaClient;
  const password = 'integration test passphrase';

  beforeAll(() => {
    config({ quiet: true });
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function withApplication(
    run: (app: INestApplication, database: Prisma.TransactionClient) => Promise<void>,
  ) {
    const rollback = new Error('Rollback integration test');
    let app: INestApplication | undefined;
    try {
      await expect(
        prisma.$transaction(
          async (database) => {
            const module = await Test.createTestingModule({ imports: [AppModule] })
              .overrideProvider(PrismaService)
              .useValue({
                user: database.user,
                session: database.session,
                organization: database.organization,
                membership: database.membership,
                $queryRaw: database.$queryRaw.bind(database),
              })
              .compile();
            app = module.createNestApplication();
            app.setGlobalPrefix('api');
            await app.init();
            await run(app, database);
            throw rollback;
          },
          { timeout: 30000 },
        ),
      ).rejects.toBe(rollback);
    } finally {
      await app?.close();
    }
  }

  async function register(app: INestApplication) {
    const input = {
      email: `${randomUUID()}@example.test`,
      password,
      displayName: 'Integration User',
    };
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(input)
      .expect(201);
    return {
      input,
      user: response.body.user as { id: string; email: string; displayName: string },
      token: response.body.accessToken as string,
    };
  }

  it('stores Argon2id credentials and token digests, logs in, and revokes sessions at logout', async () => {
    await withApplication(async (app, database) => {
      const account = await register(app);
      const stored = await database.passwordCredential.findUniqueOrThrow({
        where: { userId: account.user.id },
      });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verify(stored.passwordHash, password)).toBe(true);
      expect(stored.passwordHash).not.toBe(password);
      const sessions = await database.session.findMany({ where: { userId: account.user.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].tokenHash).toBe(createHash('sha256').update(account.token).digest('hex'));
      expect(JSON.stringify(sessions)).not.toContain(account.token);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${account.token}`)
        .expect(200)
        .expect(account.user);
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: account.input.email.toUpperCase(), password })
        .expect(200);
      expect(login.body.user).toEqual(account.user);
      expect(login.body.accessToken).not.toBe(account.token);
      expect(JSON.stringify(login.body)).not.toContain(stored.passwordHash);
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${account.token}`)
        .expect(204);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${account.token}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
    });
  });

  it('rejects wrong credentials and expired sessions without invalidating other sessions', async () => {
    await withApplication(async (app, database) => {
      const account = await register(app);
      const wrong = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: account.input.email, password: 'another passphrase' })
        .expect(401);
      const missing = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: `${randomUUID()}@example.test`, password })
        .expect(401);
      expect(wrong.body).toEqual(missing.body);
      await database.$executeRaw`
        UPDATE sessions
        SET created_at = clock_timestamp() - interval '2 minutes',
            expires_at = clock_timestamp() - interval '1 minute'
        WHERE user_id = ${account.user.id}::uuid
      `;
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${account.token}`)
        .expect(401);
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: account.input.email, password })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
    });
  });

  it('handles duplicate registration without partial credential or session records', async () => {
    await withApplication(async (app, database) => {
      const account = await register(app);
      await database.$executeRaw`SAVEPOINT duplicate_registration`;
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...account.input, email: account.input.email.toUpperCase() })
        .expect(409);
      await database.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_registration`;
      expect(await database.passwordCredential.count({ where: { userId: account.user.id } })).toBe(
        1,
      );
      expect(await database.session.count({ where: { userId: account.user.id } })).toBe(1);
      expect(await database.membership.count({ where: { userId: account.user.id } })).toBe(0);
    });
  });

  it('creates an admin membership atomically and isolates organizations from other accounts', async () => {
    await withApplication(async (app, database) => {
      const owner = await register(app);
      const outsider = await register(app);
      const ownerAuth = `Bearer ${owner.token}`;
      const outsiderAuth = `Bearer ${outsider.token}`;
      await request(app.getHttpServer()).get('/api/organizations').expect(401);
      await request(app.getHttpServer())
        .get('/api/organizations')
        .set('Authorization', ownerAuth)
        .expect(200)
        .expect([]);

      await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', ownerAuth)
        .send({ name: 'Forged Owner', currency: 'USD', userId: outsider.user.id, roles: ['ADMIN'] })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', ownerAuth)
        .send({ name: 'Invalid Currency', currency: 'ZZZ' })
        .expect(400);
      const created = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', ownerAuth)
        .send({ name: ' First Organization ', currency: 'usd' })
        .expect(201);
      const organizationId = created.body.id as string;
      expect(created.body.name).toBe('First Organization');
      expect(created.body.currency).toBe('USD');
      const membership = await database.membership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: owner.user.id } },
      });
      expect(membership.roles).toEqual(['ADMIN']);
      const listed = await request(app.getHttpServer())
        .get('/api/organizations')
        .set('Authorization', ownerAuth)
        .expect(200);
      expect(listed.body.map((organization: { id: string }) => organization.id)).toEqual([
        organizationId,
      ]);
      await request(app.getHttpServer())
        .get(`/api/organizations?userId=${owner.user.id}`)
        .set('Authorization', outsiderAuth)
        .expect(200)
        .expect([]);
      await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}`)
        .set('Authorization', ownerAuth)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}`)
        .set('Authorization', outsiderAuth)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}/members`)
        .set('Authorization', outsiderAuth)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/organizations/${organizationId}`)
        .set('Authorization', outsiderAuth)
        .send({ name: 'Unauthorized Rename' })
        .expect(404);
      expect(
        (await database.organization.findUniqueOrThrow({ where: { id: organizationId } })).name,
      ).toBe('First Organization');
      await request(app.getHttpServer())
        .get('/api/organizations/not-a-uuid')
        .set('Authorization', ownerAuth)
        .expect(400);
      await request(app.getHttpServer())
        .get(`/api/organizations/${randomUUID()}`)
        .set('Authorization', ownerAuth)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/organizations/${organizationId}`)
        .set('Authorization', ownerAuth)
        .send({ name: 'Owner Rename', currency: 'ETB' })
        .expect(400);
      await request(app.getHttpServer())
        .patch(`/api/organizations/${organizationId}`)
        .set('Authorization', ownerAuth)
        .send({ name: 'Owner Rename' })
        .expect(200);
    });
  });

  it('uses current organization-specific roles and honors role changes and revoked memberships', async () => {
    await withApplication(async (app, database) => {
      const owner = await register(app);
      const member = await register(app);
      const created = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Restricted Organization', currency: 'USD' })
        .expect(201);
      const organizationId = created.body.id as string;
      const other = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Member Own Organization', currency: 'ETB' })
        .expect(201);
      const membership = await database.membership.create({
        data: { organizationId, userId: member.user.id, roles: ['WAREHOUSE'] },
      });
      const memberAuth = `Bearer ${member.token}`;
      await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}`)
        .set('Authorization', memberAuth)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/organizations/${organizationId}`)
        .set('Authorization', memberAuth)
        .set('X-Organization-Id', other.body.id)
        .send({ name: 'Cross-organization Admin' })
        .expect(403);
      await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}/members`)
        .set('Authorization', memberAuth)
        .expect(403);
      const members = await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(members.body).toHaveLength(2);
      expect(
        members.body.every(
          (entry: { user: object }) =>
            Object.keys(entry.user).sort().join(',') === 'displayName,email,id',
        ),
      ).toBe(true);
      await database.membership.update({
        where: { id: membership.id },
        data: { roles: ['ADMIN'] },
      });
      await request(app.getHttpServer())
        .patch(`/api/organizations/${organizationId}`)
        .set('Authorization', memberAuth)
        .send({ name: 'Promoted Member Rename' })
        .expect(200);
      await database.membership.update({
        where: { id: membership.id },
        data: { roles: ['WAREHOUSE'] },
      });
      await request(app.getHttpServer())
        .patch(`/api/organizations/${organizationId}`)
        .set('Authorization', memberAuth)
        .send({ name: 'Demoted Member Rename' })
        .expect(403);
      await database.membership.delete({ where: { id: membership.id } });
      await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}`)
        .set('Authorization', memberAuth)
        .expect(404);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', memberAuth)
        .expect(200);
      const remaining = await request(app.getHttpServer())
        .get('/api/organizations')
        .set('Authorization', memberAuth)
        .expect(200);
      expect(remaining.body.map((organization: { id: string }) => organization.id)).toEqual([
        other.body.id,
      ]);
    });
  });

  it('does not claim an existing identity without credentials through registration', async () => {
    await withApplication(async (app, database) => {
      const user = await database.user.create({
        data: { email: `${randomUUID()}@example.test`, displayName: 'Existing User' },
      });
      await database.$executeRaw`SAVEPOINT existing_identity`;
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: user.email, password, displayName: 'New User' })
        .expect(409);
      await database.$executeRaw`ROLLBACK TO SAVEPOINT existing_identity`;
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password })
        .expect(401);
      expect(
        await database.passwordCredential.findUnique({ where: { userId: user.id } }),
      ).toBeNull();
    });
  });
});
