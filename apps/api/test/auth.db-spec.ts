import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { verify } from 'argon2';
import { config } from 'dotenv';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccountMailer, AccountEmail } from '../src/auth/account-mailer.service';
import { AccountService } from '../src/auth/account.service';
import { PasswordService } from '../src/auth/password.service';

describe('Authentication and authorization against PostgreSQL', () => {
  let prisma: PrismaClient;
  const password = 'integration test passphrase';
  const outbox: AccountEmail[] = [];
  let failDelivery = false;

  function mailToken(email: string, path: string) {
    const message = outbox.findLast(
      (mail) => mail.to === email && new URL(mail.actionUrl).pathname === path,
    );
    if (!message) throw new Error('Expected account email was not sent.');
    return new URLSearchParams(new URL(message.actionUrl).hash.slice(1)).get('token')!;
  }

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
    outbox.length = 0;
    failDelivery = false;
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
                accountToken: database.accountToken,
                $transaction: (
                  callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
                ) => callback(database),
                $queryRaw: database.$queryRaw.bind(database),
              })
              .overrideProvider(AccountMailer)
              .useValue({
                webOrigin: 'http://127.0.0.1:3000',
                send: async (mail: AccountEmail) => {
                  if (failDelivery) throw new Error('Private transport details');
                  outbox.push(mail);
                },
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

  async function register(app: INestApplication, verified = true) {
    const input = {
      email: `${randomUUID()}@example.test`,
      password,
      displayName: 'Integration User',
    };
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(input)
      .expect(201);
    if (verified) {
      await request(app.getHttpServer())
        .post('/api/auth/email/verify')
        .send({ token: mailToken(input.email, '/verify-email/confirm') })
        .expect(200);
    }
    const profile = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    return {
      input,
      user: profile.body as {
        id: string;
        email: string;
        displayName: string;
        emailVerifiedAt: string | null;
      },
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
      expect(members.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      expect(members.body.items).toHaveLength(2);
      expect(
        members.body.items.every(
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

  it('requires verification and accepts each purpose-bound verification link only once', async () => {
    await withApplication(async (app, database) => {
      const account = await register(app, false);
      const token = mailToken(account.input.email, '/verify-email/confirm');
      const stored = await database.accountToken.findUniqueOrThrow({
        where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      });
      expect(stored.purpose).toBe('VERIFY_EMAIL');
      expect(stored.email).toBe(account.input.email);
      expect(JSON.stringify(stored)).not.toContain(token);
      expect(new URL(outbox[0].actionUrl).search).toBe('');
      await request(app.getHttpServer())
        .get('/api/organizations')
        .set('Authorization', `Bearer ${account.token}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send({ token, password: 'a new long test passphrase' })
        .expect(400);
      await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
      await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(400);
      await request(app.getHttpServer())
        .get('/api/organizations')
        .set('Authorization', `Bearer ${account.token}`)
        .expect(200)
        .expect([]);
      expect(
        (await database.user.findUniqueOrThrow({ where: { id: account.user.id } })).emailVerifiedAt,
      ).not.toBeNull();
    });
  });

  it('rejects expired tokens and links issued for an old email address', async () => {
    await withApplication(async (app, database) => {
      const account = await register(app, false);
      const token = mailToken(account.input.email, '/verify-email/confirm');
      await database.accountToken.updateMany({
        where: { userId: account.user.id },
        data: { createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) },
      });
      await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(400);
      await request(app.getHttpServer())
        .post('/api/auth/password/reset-request')
        .send({ email: account.input.email })
        .expect(202);
      const reset = mailToken(account.input.email, '/reset-password');
      await database.user.update({
        where: { id: account.user.id },
        data: { email: `${randomUUID()}@example.test` },
      });
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send({ token: reset, password: 'a new long test passphrase' })
        .expect(400);
    });
  });

  it('does not reveal account existence or transport failures in reset requests', async () => {
    await withApplication(async (app, database) => {
      const account = await register(app);
      const known = await request(app.getHttpServer())
        .post('/api/auth/password/reset-request')
        .send({ email: account.input.email })
        .expect(202);
      const unknown = await request(app.getHttpServer())
        .post('/api/auth/password/reset-request')
        .send({ email: `${randomUUID()}@example.test` })
        .expect(202);
      const before = await database.accountToken.count({
        where: { userId: account.user.id, purpose: 'RESET_PASSWORD' },
      });
      failDelivery = true;
      const failed = await request(app.getHttpServer())
        .post('/api/auth/password/reset-request')
        .send({ email: account.input.email })
        .expect(202);
      expect(known.body).toEqual(unknown.body);
      expect(known.body).toEqual(failed.body);
      expect(
        await database.accountToken.count({
          where: { userId: account.user.id, purpose: 'RESET_PASSWORD' },
        }),
      ).toBe(before);
    });
  });

  it('resets the password once and rejects all old and in-flight sessions', async () => {
    await withApplication(async (app, database) => {
      const account = await register(app);
      const second = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: account.input.email, password })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/password/reset-request')
        .send({ email: account.input.email })
        .expect(202);
      const token = mailToken(account.input.email, '/reset-password');
      const newPassword = 'a changed integration passphrase';
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send({ token, password: newPassword })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send({ token, password: newPassword })
        .expect(400);
      for (const session of [account.token, second.body.accessToken]) {
        await request(app.getHttpServer())
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${session}`)
          .expect(401);
      }
      const staleToken = randomBytes(32).toString('base64url');
      await database.session.create({
        data: {
          userId: account.user.id,
          authVersion: 0,
          tokenHash: createHash('sha256').update(staleToken).digest('hex'),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${staleToken}`)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: account.input.email, password })
        .expect(401);
      const fresh = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: account.input.email, password: newPassword })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${fresh.body.accessToken}`)
        .expect(200);
    });
  });

  it('allows only one concurrent token consumer and only one competing password reset', async () => {
    outbox.length = 0;
    const passwords = new PasswordService();
    const email = `${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        displayName: 'Concurrent Recovery Test',
        credential: { create: { passwordHash: await passwords.hash(password) } },
      },
    });
    const accounts = new AccountService(prisma as PrismaService, passwords, {
      webOrigin: 'http://127.0.0.1:3000',
      send: async (message: AccountEmail) => {
        outbox.push(message);
      },
    } as AccountMailer);
    try {
      await accounts.sendVerification(user.id);
      const verification = mailToken(email, '/verify-email/confirm');
      const verified = await Promise.allSettled([
        accounts.verifyEmail(verification),
        accounts.verifyEmail(verification),
      ]);
      expect(verified.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(verified.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await accounts.requestReset(email);
      const first = mailToken(email, '/reset-password');
      await accounts.requestReset(email);
      const second = mailToken(email, '/reset-password');
      const results = await Promise.allSettled([
        accounts.resetPassword(first, 'first new concurrent passphrase'),
        accounts.resetPassword(second, 'second new concurrent passphrase'),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion).toBe(1);
      expect(await prisma.accountToken.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      await prisma.user.deleteMany({ where: { id: user.id, email } });
    }
  }, 15000);

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
