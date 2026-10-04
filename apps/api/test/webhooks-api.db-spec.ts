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

describe('Webhook API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'webhook integration passphrase';
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

  function testingModule(transaction: Prisma.TransactionClient) {
    return Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccountMailer)
      .useValue({
        webOrigin: 'http://127.0.0.1:3000',
        send: async (mail: AccountEmail) => {
          outbox.push(mail);
        },
      })
      .overrideProvider(PrismaService)
      .useValue({
        user: transaction.user,
        session: transaction.session,
        organization: transaction.organization,
        membership: transaction.membership,
        accountToken: transaction.accountToken,
        auditEvent: transaction.auditEvent,
        invitation: transaction.invitation,
        product: transaction.product,
        supplier: transaction.supplier,
        location: transaction.location,
        purchaseOrder: transaction.purchaseOrder,
        purchaseOrderLine: transaction.purchaseOrderLine,
        goodsReceipt: transaction.goodsReceipt,
        goodsReceiptLine: transaction.goodsReceiptLine,
        stockMovement: transaction.stockMovement,
        stockLevel: transaction.stockLevel,
        stockTransfer: transaction.stockTransfer,
        stockAdjustment: transaction.stockAdjustment,
        webhookEndpoint: transaction.webhookEndpoint,
        $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(transaction),
        $queryRaw: transaction.$queryRaw.bind(transaction),
      });
  }

  async function withApplication(
    run: (app: INestApplication, database: Prisma.TransactionClient) => Promise<void>,
  ) {
    outbox.length = 0;
    const rollback = new Error('Rollback webhook integration test');
    let app: INestApplication | undefined;
    try {
      await expect(
        prisma.$transaction(
          async (database) => {
            const module = await testingModule(database).compile();
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

  async function registerVerified(app: INestApplication, displayName = 'Webhook Test User') {
    const email = `${randomUUID()}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, displayName })
      .expect(201);
    const message = outbox.findLast((mail) => mail.to === email);
    if (!message) throw new Error('Verification email was not captured.');
    const token = new URLSearchParams(new URL(message.actionUrl!).hash.slice(1)).get('token')!;
    await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
    return { auth: `Bearer ${response.body.accessToken as string}`, email };
  }

  it('lets administrators manage endpoints and reveals the secret exactly once', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Webhook Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Webhooks ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const api = `/api/organizations/${organization.body.id as string}/webhooks`;
      const authed = (method: 'get' | 'post' | 'patch' | 'delete', path = '') =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const created = await authed('post')
        .send({ url: ' https://example.test/hooks/orders ' })
        .expect(201);
      expect(created.body.url).toBe('https://example.test/hooks/orders');
      expect(created.body.active).toBe(true);
      expect(created.body.secret).toMatch(/^[0-9a-f]{64}$/);
      const webhookId = created.body.id as string;
      const stored = await database.webhookEndpoint.findUniqueOrThrow({
        where: { id: webhookId },
      });
      expect(stored.secret).toBe(created.body.secret);

      // Reads never include the secret.
      const list = await authed('get').expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        id: webhookId,
        url: 'https://example.test/hooks/orders',
        active: true,
      });
      expect(list.body.items[0].secret).toBeUndefined();

      await authed('post').send({ url: 'ftp://example.test/hooks' }).expect(400);
      await authed('post').send({ url: 'not a url' }).expect(400);

      const disabled = await authed('patch', `/${webhookId}`).send({ active: false }).expect(200);
      expect(disabled.body.active).toBe(false);
      expect(disabled.body.secret).toBeUndefined();
      const enabled = await authed('patch', `/${webhookId}`).send({ active: true }).expect(200);
      expect(enabled.body.active).toBe(true);

      await authed('delete', `/${webhookId}`).expect(204);
      expect((await authed('get').expect(200)).body.items).toEqual([]);
      await authed('patch', `/${webhookId}`).send({ active: false }).expect(404);
      await authed('delete', `/${webhookId}`).expect(404);
      await authed('delete', '/not-a-uuid').expect(404);

      const audit = await database.auditEvent.findMany({
        where: { organizationId: organization.body.id as string, entityType: 'webhook' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit.map((event) => event.action)).toEqual([
        'webhook.created',
        'webhook.disabled',
        'webhook.enabled',
        'webhook.deleted',
      ]);
      expect(audit[0].summary).toBe('Added a webhook for https://example.test/hooks/orders');
    });
  }, 60000);

  it('restricts webhook management to administrators of active organizations', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Webhook Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Webhooks ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}/webhooks`;

      // A manager cannot even read the endpoint list.
      const manager = await registerVerified(app, 'Webhook Manager');
      await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/invitations`)
        .set('Authorization', owner.auth)
        .send({ email: manager.email, roles: ['MANAGER'] })
        .expect(201);
      const inviteMail = outbox.findLast((mail) => mail.to === manager.email)!;
      const inviteToken = new URLSearchParams(new URL(inviteMail.actionUrl!).hash.slice(1)).get(
        'token',
      )!;
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', manager.auth)
        .send({ token: inviteToken })
        .expect(200);
      await request(app.getHttpServer()).get(api).set('Authorization', manager.auth).expect(403);
      await request(app.getHttpServer())
        .post(api)
        .set('Authorization', manager.auth)
        .send({ url: 'https://example.test/hooks' })
        .expect(403);

      const outsider = await registerVerified(app, 'Webhook Outsider');
      await request(app.getHttpServer()).get(api).set('Authorization', outsider.auth).expect(404);
      await request(app.getHttpServer()).get(api).expect(401);

      // Archived organizations stay readable but reject changes.
      const created = await request(app.getHttpServer())
        .post(api)
        .set('Authorization', owner.auth)
        .send({ url: 'https://example.test/hooks' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer()).get(api).set('Authorization', owner.auth).expect(200);
      await request(app.getHttpServer())
        .post(api)
        .set('Authorization', owner.auth)
        .send({ url: 'https://example.test/other' })
        .expect(409);
      await request(app.getHttpServer())
        .delete(`${api}/${created.body.id as string}`)
        .set('Authorization', owner.auth)
        .expect(409);
      expect(await database.webhookEndpoint.count({ where: { organizationId } })).toBe(1);
    });
  }, 60000);
});
