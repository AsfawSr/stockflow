import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AccountEmail, AccountMailer } from '../src/auth/account-mailer.service';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookRetryService } from '../src/webhooks/webhook-retry.service';

type Delivery = {
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

describe('Webhook retries against PostgreSQL', () => {
  let prisma: PrismaService;
  let server: Server;
  let receiverUrl: string;
  let receiverMode: 'ok' | 'fail' = 'fail';
  const password = 'webhook retry integration passphrase';
  const outbox: AccountEmail[] = [];
  const deliveries: Delivery[] = [];

  beforeAll(async () => {
    config({ quiet: true });
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        deliveries.push({ headers: incoming.headers, body: Buffer.concat(chunks).toString() });
        response.writeHead(receiverMode === 'ok' ? 200 : 500).end();
      });
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await new Promise<void>((closed) => server?.close(() => closed()));
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
        webhookEndpoint: transaction.webhookEndpoint,
        webhookDelivery: transaction.webhookDelivery,
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
        $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          callback(transaction),
        $queryRaw: transaction.$queryRaw.bind(transaction),
      });
  }

  async function withApplication(
    run: (app: INestApplication, database: Prisma.TransactionClient) => Promise<void>,
  ) {
    outbox.length = 0;
    deliveries.length = 0;
    receiverMode = 'fail';
    const rollback = new Error('Rollback webhook retry integration test');
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

  async function registerVerified(app: INestApplication, displayName = 'Retry Test User') {
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

  it('retries failed deliveries until success and gives up after the attempt budget', async () => {
    await withApplication(async (app, database) => {
      const retry = app.get(WebhookRetryService);
      const owner = await registerVerified(app, 'Retry Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Retry ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'patch', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const webhook = await authed('post', '/webhooks').send({ url: receiverUrl }).expect(201);
      const webhookId = webhook.body.id as string;
      const secret = webhook.body.secret as string;

      const supplier = await authed('post', '/suppliers').send({ name: 'Retry Supplier' });
      const location = await authed('post', '/locations').send({ name: 'Retry Warehouse' });
      const product = await authed('post', '/products').send({
        sku: 'RETRY-1',
        name: 'Retried Widget',
        unit: 'piece',
      });
      const order = await authed('post', '/purchase-orders')
        .send({ supplierId: supplier.body.id, locationId: location.body.id })
        .expect(201);
      const orderId = order.body.id as string;
      await authed('post', `/purchase-orders/${orderId}/lines`)
        .send({ productId: product.body.id, quantity: 2, unitPrice: '3.00' })
        .expect(201);

      // The receiver answers 500, so the first attempt queues a retry.
      await authed('post', `/purchase-orders/${orderId}/submit`).expect(200);
      expect(deliveries).toHaveLength(1);
      const queued = await database.webhookDelivery.findFirstOrThrow({
        where: { webhookEndpointId: webhookId },
      });
      expect(queued).toMatchObject({ status: 'PENDING', attempts: 1, responseStatus: 500 });
      expect(queued.lastError).toBe('HTTP 500');

      // A due row is not retried before its backoff elapses.
      expect(await retry.sweep()).toBe(0);
      expect(deliveries).toHaveLength(1);

      const backdate = () =>
        database.webhookDelivery.update({
          where: { id: queued.id },
          data: { nextAttemptAt: new Date(Date.now() - 60_000) },
        });

      // Still failing: the attempt is counted and the row stays queued.
      await backdate();
      expect(await retry.sweep()).toBe(1);
      expect(deliveries).toHaveLength(2);
      let row = await database.webhookDelivery.findUniqueOrThrow({ where: { id: queued.id } });
      expect(row).toMatchObject({ status: 'PENDING', attempts: 2, responseStatus: 500 });
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

      // Disabled endpoints are left alone until re-enabled.
      await authed('patch', `/webhooks/${webhookId}`).send({ active: false }).expect(200);
      await backdate();
      expect(await retry.sweep()).toBe(0);
      expect(deliveries).toHaveLength(2);
      await authed('patch', `/webhooks/${webhookId}`).send({ active: true }).expect(200);

      // The receiver recovers: the same signed body is delivered and the row closes.
      receiverMode = 'ok';
      expect(await retry.sweep()).toBe(1);
      expect(deliveries).toHaveLength(3);
      const retried = deliveries[2];
      expect(retried.body).toBe(deliveries[0].body);
      const expected = createHmac('sha256', secret).update(retried.body).digest('hex');
      expect(retried.headers['x-stockflow-signature']).toBe(`sha256=${expected}`);
      expect(retried.headers['x-stockflow-event']).toBe('order.submitted');
      row = await database.webhookDelivery.findUniqueOrThrow({ where: { id: queued.id } });
      expect(row).toMatchObject({
        status: 'SUCCEEDED',
        attempts: 3,
        responseStatus: 200,
        lastError: null,
        nextAttemptAt: null,
      });

      // A delivery that keeps failing becomes FAILED once the budget is spent.
      receiverMode = 'fail';
      await authed('post', `/purchase-orders/${orderId}/approve`).send({}).expect(200);
      const doomed = await database.webhookDelivery.findFirstOrThrow({
        where: { webhookEndpointId: webhookId, event: 'order.approved' },
      });
      expect(doomed).toMatchObject({ status: 'PENDING', attempts: 1 });
      await database.webhookDelivery.update({
        where: { id: doomed.id },
        data: { attempts: 4, nextAttemptAt: new Date(Date.now() - 60_000) },
      });
      expect(await retry.sweep()).toBe(1);
      const failed = await database.webhookDelivery.findUniqueOrThrow({ where: { id: doomed.id } });
      expect(failed).toMatchObject({
        status: 'FAILED',
        attempts: 5,
        responseStatus: 500,
        lastError: 'HTTP 500',
        nextAttemptAt: null,
      });

      // Terminal rows are never picked up again.
      expect(await retry.sweep()).toBe(0);
    });
  }, 60000);
});
