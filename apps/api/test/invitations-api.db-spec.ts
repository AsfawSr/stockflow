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

describe('Invitation APIs against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'invitation integration passphrase';
  const outbox: AccountEmail[] = [];
  let failNextMail = false;

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
          if (failNextMail) {
            failNextMail = false;
            throw new Error('Simulated mail outage');
          }
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
    failNextMail = false;
    const rollback = new Error('Rollback invitation integration test');
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

  function mailToken(recipient: string, path: string) {
    const message = outbox.findLast(
      (mail) => mail.to === recipient && new URL(mail.actionUrl).pathname === path,
    );
    if (!message) throw new Error(`Expected email to ${recipient} for ${path}.`);
    return new URLSearchParams(new URL(message.actionUrl).hash.slice(1)).get('token')!;
  }

  async function registerVerified(app: INestApplication, email = `${randomUUID()}@example.test`) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Invitation Test User' })
      .expect(201);
    const token = mailToken(email, '/verify-email/confirm');
    await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
    return { auth: `Bearer ${response.body.accessToken as string}`, email };
  }

  async function createOrganization(app: INestApplication, auth: string) {
    const organization = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', auth)
      .send({ name: `Invitation ${randomUUID().slice(0, 8)}`, currency: 'USD' })
      .expect(201);
    return organization.body.id as string;
  }

  it('invites, replaces, lists, and accepts memberships with the invited roles', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth);
      const base = `/api/organizations/${organizationId}/invitations`;
      const inviteeEmail = `${randomUUID()}@example.test`;

      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ email: ` ${inviteeEmail.toUpperCase()} `, roles: ['MANAGER', 'WAREHOUSE'] })
        .expect(201);
      expect(created.body).toMatchObject({
        email: inviteeEmail,
        roles: ['MANAGER', 'WAREHOUSE'],
        invitedBy: { displayName: 'Invitation Test User' },
      });
      expect(created.body.tokenHash).toBeUndefined();
      const firstToken = mailToken(inviteeEmail, '/invitations/accept');

      // Re-inviting replaces the pending invitation and its link.
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ email: inviteeEmail, roles: ['PURCHASER'] })
        .expect(201);
      const secondToken = mailToken(inviteeEmail, '/invitations/accept');
      expect(secondToken).not.toBe(firstToken);
      const listed = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].roles).toEqual(['PURCHASER']);

      const invitee = await registerVerified(app, inviteeEmail);
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', invitee.auth)
        .send({ token: firstToken })
        .expect(400);
      const accepted = await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', invitee.auth)
        .send({ token: secondToken })
        .expect(200);
      expect(accepted.body).toMatchObject({ id: organizationId, roles: ['PURCHASER'] });

      const organizations = await request(app.getHttpServer())
        .get('/api/organizations')
        .set('Authorization', invitee.auth)
        .expect(200);
      expect(organizations.body.map((membership: { id: string }) => membership.id)).toContain(
        organizationId,
      );
      const remaining = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(remaining.body).toHaveLength(0);
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', invitee.auth)
        .send({ token: secondToken })
        .expect(400);
    });
  }, 60000);

  it('rejects invalid, mismatched, expired, and already-member invitations', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth);
      const base = `/api/organizations/${organizationId}/invitations`;

      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ email: owner.email, roles: ['MANAGER'] })
        .expect(409);
      for (const roles of [[], ['ADMIN', 'ADMIN'], ['SUPERUSER']]) {
        await request(app.getHttpServer())
          .post(base)
          .set('Authorization', owner.auth)
          .send({ email: `${randomUUID()}@example.test`, roles })
          .expect(400);
      }
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ email: 'not-an-email', roles: ['MANAGER'] })
        .expect(400);

      const inviteeEmail = `${randomUUID()}@example.test`;
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ email: inviteeEmail, roles: ['MANAGER'] })
        .expect(201);
      const token = mailToken(inviteeEmail, '/invitations/accept');
      const wrongUser = await registerVerified(app);
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', wrongUser.auth)
        .send({ token })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .send({ token })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', wrongUser.auth)
        .send({ token: 'short' })
        .expect(400);

      const invitee = await registerVerified(app, inviteeEmail);
      await database.invitation.updateMany({
        where: { organizationId, email: inviteeEmail },
        data: {
          createdAt: new Date(Date.now() - 8 * 24 * 60 * 60000),
          expiresAt: new Date(Date.now() - 24 * 60 * 60000),
        },
      });
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', invitee.auth)
        .send({ token })
        .expect(400);
      const listed = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(listed.body).toHaveLength(0);

      failNextMail = true;
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ email: `${randomUUID()}@example.test`, roles: ['MANAGER'] })
        .expect(503);
      const afterFailure = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(afterFailure.body).toHaveLength(0);
    });
  }, 60000);

  it('restricts invitation management to admins and isolates organizations', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const outsider = await registerVerified(app);
      const member = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth);
      const base = `/api/organizations/${organizationId}/invitations`;

      await request(app.getHttpServer()).get(base).expect(401);
      await request(app.getHttpServer()).get(base).set('Authorization', outsider.auth).expect(404);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', outsider.auth)
        .send({ email: `${randomUUID()}@example.test`, roles: ['ADMIN'] })
        .expect(404);

      const account = await database.user.findUniqueOrThrow({
        where: { email: member.email },
        select: { id: true },
      });
      await database.membership.create({
        data: { organizationId, userId: account.id, roles: ['PURCHASER'] },
      });
      await request(app.getHttpServer()).get(base).set('Authorization', member.auth).expect(403);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', member.auth)
        .send({ email: `${randomUUID()}@example.test`, roles: ['MANAGER'] })
        .expect(403);

      const inviteeEmail = `${randomUUID()}@example.test`;
      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ email: inviteeEmail, roles: ['MANAGER'] })
        .expect(201);
      const invitationId = created.body.id as string;
      const token = mailToken(inviteeEmail, '/invitations/accept');
      await request(app.getHttpServer())
        .delete(`${base}/${invitationId}`)
        .set('Authorization', member.auth)
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${base}/${invitationId}`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`${base}/${invitationId}`)
        .set('Authorization', owner.auth)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`${base}/${invitationId}`)
        .set('Authorization', owner.auth)
        .expect(404);
      const invitee = await registerVerified(app, inviteeEmail);
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', invitee.auth)
        .send({ token })
        .expect(400);
    });
  }, 60000);

  it('serializes concurrent accepts of the same invitation on committed data', async () => {
    outbox.length = 0;
    failNextMail = false;
    const app = await buildApp(prisma);
    const organizationIds: string[] = [];
    const userEmails: string[] = [];
    try {
      const ownerEmail = `${randomUUID()}@example.test`;
      const inviteeEmail = `${randomUUID()}@example.test`;
      userEmails.push(ownerEmail, inviteeEmail);
      const owner = await registerVerified(app, ownerEmail);
      const invitee = await registerVerified(app, inviteeEmail);
      const organizationId = await createOrganization(app, owner.auth);
      organizationIds.push(organizationId);
      await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/invitations`)
        .set('Authorization', owner.auth)
        .send({ email: inviteeEmail, roles: ['WAREHOUSE'] })
        .expect(201);
      const token = mailToken(inviteeEmail, '/invitations/accept');

      const accepts = await Promise.all([
        request(app.getHttpServer())
          .post('/api/invitations/accept')
          .set('Authorization', invitee.auth)
          .send({ token }),
        request(app.getHttpServer())
          .post('/api/invitations/accept')
          .set('Authorization', invitee.auth)
          .send({ token }),
      ]);
      const statuses = accepts.map((response) => response.status).sort();
      expect(statuses[0]).toBe(200);
      expect([400, 409]).toContain(statuses[1]);
      const memberships = await prisma.membership.findMany({
        where: { organizationId },
        select: { roles: true },
      });
      expect(memberships).toHaveLength(2);
      expect(await prisma.invitation.count({ where: { organizationId } })).toBe(0);
    } finally {
      await prisma.invitation.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.membership.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
      await app.close();
    }
  }, 60000);
});
