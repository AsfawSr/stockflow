import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AccountEmail, AccountMailer } from '../src/auth/account-mailer.service';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Password change API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'password change original passphrase';
  const newPassword = 'password change updated passphrase';
  const outbox: AccountEmail[] = [];

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
    const rollback = new Error('Rollback password change test');
    let app: INestApplication | undefined;
    try {
      await expect(
        prisma.$transaction(
          async (database) => {
            const module = await Test.createTestingModule({ imports: [AppModule] })
              .overrideProvider(AccountMailer)
              .useValue({
                webOrigin: 'http://127.0.0.1:3000',
                send: async (mail: AccountEmail) => {
                  outbox.push(mail);
                },
              })
              .overrideProvider(PrismaService)
              .useValue({
                user: database.user,
                session: database.session,
                passwordCredential: database.passwordCredential,
                accountToken: database.accountToken,
                $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
                  callback(database),
                $queryRaw: database.$queryRaw.bind(database),
              })
              .compile();
            app = module.createNestApplication();
            app.setGlobalPrefix('api');
            await app.init();
            await run(app, database);
            throw rollback;
          },
          { timeout: 60000 },
        ),
      ).rejects.toBe(rollback);
    } finally {
      await app?.close();
    }
  }

  function mailToken(recipient: string, path: string) {
    const message = outbox.findLast(
      (mail) => mail.to === recipient && new URL(mail.actionUrl!).pathname === path,
    );
    if (!message) throw new Error(`Expected email to ${recipient} for ${path}.`);
    return new URLSearchParams(new URL(message.actionUrl!).hash.slice(1)).get('token')!;
  }

  it('replaces the credential, keeps only the proving session, and voids account links', async () => {
    await withApplication(async (app) => {
      const email = `${randomUUID()}@example.test`;
      const registered = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, displayName: 'Password Change User' })
        .expect(201);
      const currentAuth = `Bearer ${registered.body.accessToken as string}`;
      const other = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      const otherAuth = `Bearer ${other.body.accessToken as string}`;
      await request(app.getHttpServer())
        .post('/api/auth/password/reset-request')
        .send({ email })
        .expect(202);
      const resetToken = mailToken(email, '/reset-password');
      const verifyToken = mailToken(email, '/verify-email/confirm');

      const wrong = await request(app.getHttpServer())
        .post('/api/auth/password/change')
        .set('Authorization', currentAuth)
        .send({ currentPassword: 'not the password at all', newPassword })
        .expect(400);
      expect(wrong.body.message).toBe('Your current password is incorrect.');
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', otherAuth)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/password/change')
        .set('Authorization', currentAuth)
        .send({ currentPassword: password, newPassword })
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', currentAuth)
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', otherAuth)
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: newPassword })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/auth/password/reset')
        .send({ token: resetToken, password: 'a completely different passphrase' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/auth/email/verify')
        .send({ token: verifyToken })
        .expect(400);
    });
  }, 60000);

  it('rejects weak replacements and unauthenticated calls', async () => {
    await withApplication(async (app) => {
      const email = `${randomUUID()}@example.test`;
      const registered = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, displayName: 'Password Change User' })
        .expect(201);
      const auth = `Bearer ${registered.body.accessToken as string}`;
      await request(app.getHttpServer())
        .post('/api/auth/password/change')
        .send({ currentPassword: password, newPassword })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/password/change')
        .set('Authorization', auth)
        .send({ currentPassword: password, newPassword: 'short' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/auth/password/change')
        .set('Authorization', auth)
        .send({ currentPassword: password })
        .expect(400);
      // The failed attempts changed nothing.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
    });
  }, 60000);
});
