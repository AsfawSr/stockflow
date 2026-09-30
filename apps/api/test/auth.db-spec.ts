import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
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
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
        statement_timeout: 5000,
        max: 2,
      }),
    });
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
              .useValue(database)
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
      await database.session.updateMany({
        where: { userId: account.user.id },
        data: { createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) },
      });
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
