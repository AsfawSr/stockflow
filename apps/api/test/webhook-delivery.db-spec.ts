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

type Delivery = {
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

describe('Webhook delivery against PostgreSQL', () => {
  let prisma: PrismaService;
  let server: Server;
  let receiverUrl: string;
  const password = 'webhook delivery integration passphrase';
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
        response.writeHead(200).end();
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
        supplierCatalogPrice: transaction.supplierCatalogPrice,
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
    const rollback = new Error('Rollback webhook delivery integration test');
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

  async function registerVerified(app: INestApplication, displayName = 'Delivery Test User') {
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

  it('signs deliveries, skips disabled endpoints, and survives unreachable receivers', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Delivery Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Delivery ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'patch', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const webhook = await authed('post', '/webhooks').send({ url: receiverUrl }).expect(201);
      const secret = webhook.body.secret as string;

      const supplier = await authed('post', '/suppliers').send({ name: 'Delivery Supplier' });
      const location = await authed('post', '/locations').send({ name: 'Delivery Warehouse' });
      const product = await authed('post', '/products').send({
        sku: 'HOOK-1',
        name: 'Hooked Widget',
        unit: 'piece',
      });
      const order = await authed('post', '/purchase-orders')
        .send({ supplierId: supplier.body.id, locationId: location.body.id })
        .expect(201);
      const orderId = order.body.id as string;
      await authed('post', `/purchase-orders/${orderId}/lines`)
        .send({ productId: product.body.id, quantity: 4, unitPrice: '2.50' })
        .expect(201);
      expect(deliveries).toHaveLength(0);

      // Submitting delivers one signed event describing the order.
      await authed('post', `/purchase-orders/${orderId}/submit`).expect(200);
      expect(deliveries).toHaveLength(1);
      const delivery = deliveries[0];
      expect(delivery.headers['content-type']).toBe('application/json');
      expect(delivery.headers['x-stockflow-event']).toBe('order.submitted');
      const expected = createHmac('sha256', secret).update(delivery.body).digest('hex');
      expect(delivery.headers['x-stockflow-signature']).toBe(`sha256=${expected}`);
      const payload = JSON.parse(delivery.body);
      expect(payload).toMatchObject({
        event: 'order.submitted',
        organizationId,
        order: { id: orderId, reference: 'PO-0001', status: 'SUBMITTED', total: '10.00' },
      });
      expect(new Date(payload.occurredAt).getTime()).not.toBeNaN();

      // The attempt is recorded as a succeeded delivery with the exact signed body.
      const logged = await database.webhookDelivery.findMany({ where: { organizationId } });
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        webhookEndpointId: webhook.body.id as string,
        event: 'order.submitted',
        status: 'SUCCEEDED',
        attempts: 1,
        responseStatus: 200,
        lastError: null,
        nextAttemptAt: null,
      });
      expect(logged[0].body).toBe(delivery.body);

      // A disabled endpoint receives nothing.
      await authed('patch', `/webhooks/${webhook.body.id as string}`)
        .send({ active: false })
        .expect(200);
      await authed('post', `/purchase-orders/${orderId}/approve`).send({}).expect(200);
      expect(deliveries).toHaveLength(1);
      expect(await database.webhookDelivery.count({ where: { organizationId } })).toBe(1);

      // An unreachable endpoint never blocks the transition; the failure is queued for retry.
      const unreachable = await authed('post', '/webhooks')
        .send({ url: 'http://127.0.0.1:9/unreachable' })
        .expect(201);
      const detail = await authed('get', `/purchase-orders/${orderId}`).expect(200);
      const lineId = detail.body.lines[0].id as string;
      await authed('post', `/purchase-orders/${orderId}/receipts`)
        .send({ lines: [{ purchaseOrderLineId: lineId, quantity: 4 }] })
        .expect(201);
      expect(deliveries).toHaveLength(1);
      const queued = await database.webhookDelivery.findMany({
        where: { webhookEndpointId: unreachable.body.id as string },
      });
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        event: 'order.received',
        status: 'PENDING',
        attempts: 1,
        responseStatus: null,
      });
      expect(queued[0].lastError).toBeTruthy();
      expect(queued[0].nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    });
  }, 60000);
});
