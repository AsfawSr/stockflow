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

describe('Member management APIs against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'member management passphrase';
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

  async function buildApp(database: Prisma.TransactionClient | PrismaService) {
    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccountMailer)
      .useValue({
        webOrigin: 'http://127.0.0.1:3000',
        send: async (mail: AccountEmail) => {
          outbox.push(mail);
        },
      });
    if (database !== prisma) {
      const transaction = database as Prisma.TransactionClient;
      builder = builder.overrideProvider(PrismaService).useValue({
        user: transaction.user,
        session: transaction.session,
        organization: transaction.organization,
        membership: transaction.membership,
        accountToken: transaction.accountToken,
        auditEvent: transaction.auditEvent,
        invitation: transaction.invitation,
        $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(transaction),
        $queryRaw: transaction.$queryRaw.bind(transaction),
      });
    }
    const module = await builder.compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    return app;
  }

  async function withApplication(
    run: (app: INestApplication, database: Prisma.TransactionClient) => Promise<void>,
  ) {
    outbox.length = 0;
    const rollback = new Error('Rollback member management test');
    let app: INestApplication | undefined;
    try {
      await expect(
        prisma.$transaction(
          async (database) => {
            app = await buildApp(database);
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

  async function registerVerified(app: INestApplication, email = `${randomUUID()}@example.test`) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Member Test User' })
      .expect(201);
    const message = outbox.findLast(
      (mail) => mail.to === email && new URL(mail.actionUrl!).pathname === '/verify-email/confirm',
    );
    if (!message) throw new Error('Verification email was not captured.');
    const token = new URLSearchParams(new URL(message.actionUrl!).hash.slice(1)).get('token')!;
    await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
    return {
      auth: `Bearer ${response.body.accessToken as string}`,
      email,
      id: response.body.user.id as string,
    };
  }

  async function createOrganization(app: INestApplication, auth: string) {
    const organization = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', auth)
      .send({ name: `Members ${randomUUID().slice(0, 8)}`, currency: 'USD' })
      .expect(201);
    return organization.body.id as string;
  }

  it('updates member roles with immediate effect and removes members', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const member = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth);
      await database.membership.create({
        data: { organizationId, userId: member.id, roles: ['PURCHASER'] },
      });
      const base = `/api/organizations/${organizationId}/members`;

      // The purchaser cannot see the member list until promoted, without a new login.
      await request(app.getHttpServer()).get(base).set('Authorization', member.auth).expect(403);
      const updated = await request(app.getHttpServer())
        .patch(`${base}/${member.id}`)
        .set('Authorization', owner.auth)
        .send({ roles: ['ADMIN', 'WAREHOUSE'] })
        .expect(200);
      expect(updated.body).toMatchObject({
        roles: ['ADMIN', 'WAREHOUSE'],
        user: { id: member.id, email: member.email },
      });
      await request(app.getHttpServer()).get(base).set('Authorization', member.auth).expect(200);
      const profile = await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}`)
        .set('Authorization', member.auth)
        .expect(200);
      expect(profile.body.roles).toEqual(['ADMIN', 'WAREHOUSE']);

      // With a second admin present, the owner can step down and be removed.
      await request(app.getHttpServer())
        .patch(`${base}/${owner.id}`)
        .set('Authorization', owner.auth)
        .send({ roles: ['MANAGER'] })
        .expect(200);
      await request(app.getHttpServer()).get(base).set('Authorization', owner.auth).expect(403);
      await request(app.getHttpServer())
        .delete(`${base}/${owner.id}`)
        .set('Authorization', member.auth)
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}`)
        .set('Authorization', owner.auth)
        .expect(404);
      const members = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', member.auth)
        .expect(200);
      expect(members.body.total).toBe(1);
      expect(members.body.items).toHaveLength(1);
      const paged = await request(app.getHttpServer())
        .get(`${base}?page=2&pageSize=1`)
        .set('Authorization', member.auth)
        .expect(200);
      expect(paged.body).toMatchObject({ total: 1, page: 2, pageSize: 1 });
      expect(paged.body.items).toHaveLength(0);
    });
  }, 60000);

  it('protects the last administrator and enforces admin-only management', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const member = await registerVerified(app);
      const outsider = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth);
      await database.membership.create({
        data: { organizationId, userId: member.id, roles: ['MANAGER'] },
      });
      const base = `/api/organizations/${organizationId}/members`;

      const demoted = await request(app.getHttpServer())
        .patch(`${base}/${owner.id}`)
        .set('Authorization', owner.auth)
        .send({ roles: ['PURCHASER'] })
        .expect(409);
      expect(demoted.body.message).toBe('An organization needs at least one administrator.');
      await request(app.getHttpServer())
        .delete(`${base}/${owner.id}`)
        .set('Authorization', owner.auth)
        .expect(409);
      // Keeping the admin role while adding others is allowed.
      await request(app.getHttpServer())
        .patch(`${base}/${owner.id}`)
        .set('Authorization', owner.auth)
        .send({ roles: ['ADMIN', 'MANAGER'] })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`${base}/${member.id}`)
        .set('Authorization', member.auth)
        .send({ roles: ['ADMIN'] })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${base}/${member.id}`)
        .set('Authorization', member.auth)
        .expect(403);
      await request(app.getHttpServer())
        .patch(`${base}/${member.id}`)
        .set('Authorization', outsider.auth)
        .send({ roles: ['ADMIN'] })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`${base}/${outsider.id}`)
        .set('Authorization', owner.auth)
        .send({ roles: ['MANAGER'] })
        .expect(404);
      for (const roles of [[], ['ADMIN', 'ADMIN'], ['SUPERUSER']]) {
        await request(app.getHttpServer())
          .patch(`${base}/${member.id}`)
          .set('Authorization', owner.auth)
          .send({ roles })
          .expect(400);
      }
      await request(app.getHttpServer())
        .patch(`${base}/not-a-uuid`)
        .set('Authorization', owner.auth)
        .send({ roles: ['MANAGER'] })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`${base}/${member.id}`)
        .send({ roles: ['ADMIN'] })
        .expect(401);
    });
  }, 60000);

  it('serializes concurrent demotions so one administrator always remains', async () => {
    outbox.length = 0;
    const app = await buildApp(prisma);
    const organizationIds: string[] = [];
    const userEmails: string[] = [];
    try {
      const first = await registerVerified(app);
      const second = await registerVerified(app);
      userEmails.push(first.email, second.email);
      const organizationId = await createOrganization(app, first.auth);
      organizationIds.push(organizationId);
      await prisma.membership.create({
        data: { organizationId, userId: second.id, roles: ['ADMIN'] },
      });
      const base = `/api/organizations/${organizationId}/members`;

      const demotions = await Promise.all([
        request(app.getHttpServer())
          .patch(`${base}/${second.id}`)
          .set('Authorization', first.auth)
          .send({ roles: ['MANAGER'] }),
        request(app.getHttpServer())
          .patch(`${base}/${first.id}`)
          .set('Authorization', second.auth)
          .send({ roles: ['MANAGER'] }),
      ]);
      // The loser fails in the access guard (already demoted) or the last-admin check.
      const statuses = demotions.map((response) => response.status).sort();
      expect(statuses[0]).toBe(200);
      expect([403, 409]).toContain(statuses[1]);
      const admins = await prisma.membership.count({
        where: { organizationId, roles: { has: 'ADMIN' } },
      });
      expect(admins).toBe(1);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.membership.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
      await app.close();
    }
  }, 60000);
});
