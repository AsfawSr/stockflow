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

describe('Valuation snapshot API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'report snapshot integration passphrase';
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
        webhookEndpoint: transaction.webhookEndpoint,
        webhookDelivery: transaction.webhookDelivery,
        reportSnapshot: transaction.reportSnapshot,
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
    const rollback = new Error('Rollback snapshot integration test');
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

  async function registerVerified(app: INestApplication, displayName = 'Snapshot Test User') {
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

  async function addMember(
    app: INestApplication,
    ownerAuth: string,
    organizationId: string,
    roles: string[],
    displayName: string,
  ) {
    const member = await registerVerified(app, displayName);
    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/invitations`)
      .set('Authorization', ownerAuth)
      .send({ email: member.email, roles })
      .expect(201);
    const mail = outbox.findLast((message) => message.to === member.email)!;
    const token = new URLSearchParams(new URL(mail.actionUrl!).hash.slice(1)).get('token')!;
    await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .set('Authorization', member.auth)
      .send({ token })
      .expect(200);
    return member;
  }

  it('freezes the current valuation, lists history, and keeps snapshots immutable', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Snapshot Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Snapshots ${randomUUID().slice(0, 8)}`, currency: 'ETB' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      // Build real cost history: receive 10 units at 2.00.
      const supplier = await authed('post', '/suppliers').send({ name: 'Snapshot Supplier' });
      const location = await authed('post', '/locations').send({ name: 'Snapshot Warehouse' });
      const product = await authed('post', '/products').send({
        sku: 'SNAP-1',
        name: 'Snapped Widget',
        unit: 'piece',
      });
      const order = await authed('post', '/purchase-orders')
        .send({ supplierId: supplier.body.id, locationId: location.body.id })
        .expect(201);
      const orderId = order.body.id as string;
      const line = await authed('post', `/purchase-orders/${orderId}/lines`)
        .send({ productId: product.body.id, quantity: 10, unitPrice: '2.00' })
        .expect(201);
      await authed('post', `/purchase-orders/${orderId}/submit`).expect(200);
      await authed('post', `/purchase-orders/${orderId}/approve`).send({}).expect(200);
      await authed('post', `/purchase-orders/${orderId}/receipts`)
        .send({ lines: [{ purchaseOrderLineId: line.body.lines[0].id, quantity: 10 }] })
        .expect(201);

      const created = await authed('post', '/reports/valuation/snapshots').expect(201);
      expect(created.body.type).toBe('valuation');
      expect(created.body.payload).toMatchObject({ currency: 'ETB', totalValue: '20.00' });
      expect(created.body.payload.items).toHaveLength(1);
      expect(created.body.payload.items[0]).toMatchObject({
        onHand: 10,
        averageCost: '2.00',
        value: '20.00',
      });
      expect(created.body.createdBy.displayName).toBe('Snapshot Owner');
      const snapshotId = created.body.id as string;

      // The ledger moves on; the snapshot does not.
      await authed('post', '/stock/adjustments')
        .send({
          productId: product.body.id,
          locationId: location.body.id,
          quantity: -2,
          reason: 'Damaged',
        })
        .expect(201);
      const detail = await authed('get', `/reports/valuation/snapshots/${snapshotId}`).expect(200);
      expect(detail.body.payload).toMatchObject({ totalValue: '20.00' });
      const live = await authed('get', '/stock/valuation').expect(200);
      expect(live.body.totalValue).toBe('16.00');

      const second = await authed('post', '/reports/valuation/snapshots').expect(201);
      expect(second.body.payload.totalValue).toBe('16.00');

      const list = await authed('get', '/reports/valuation/snapshots?page=1&pageSize=1').expect(
        200,
      );
      expect(list.body.total).toBe(2);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({
        currency: 'ETB',
        totalValue: '16.00',
        productCount: 1,
      });
      expect(list.body.items[0].payload).toBeUndefined();
      const lastPage = await authed('get', '/reports/valuation/snapshots?page=2&pageSize=1').expect(
        200,
      );
      expect(lastPage.body.items[0]).toMatchObject({ totalValue: '20.00' });

      await authed('get', `/reports/valuation/snapshots/${randomUUID()}`).expect(404);
      await authed('get', '/reports/valuation/snapshots/not-a-uuid').expect(404);

      const audit = await database.auditEvent.findMany({
        where: { organizationId, action: 'report.snapshot_created' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit).toHaveLength(2);
      expect(audit[0].summary).toBe('Saved a valuation snapshot of 20.00 ETB');
      expect(audit[0].entityId).toBe(snapshotId);
    });
  }, 60000);

  it('limits snapshot creation to administrators and managers of active organizations', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Snapshot Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Snapshots ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}/reports/valuation/snapshots`;

      const manager = await addMember(
        app,
        owner.auth,
        organizationId,
        ['MANAGER'],
        'Snapshot Manager',
      );
      const warehouse = await addMember(
        app,
        owner.auth,
        organizationId,
        ['WAREHOUSE'],
        'Snapshot Warehouse',
      );

      await request(app.getHttpServer()).post(api).set('Authorization', manager.auth).expect(201);
      await request(app.getHttpServer()).post(api).set('Authorization', warehouse.auth).expect(403);
      // Every member can read the history.
      const asWarehouse = await request(app.getHttpServer())
        .get(api)
        .set('Authorization', warehouse.auth)
        .expect(200);
      expect(asWarehouse.body.total).toBe(1);

      const outsider = await registerVerified(app, 'Snapshot Outsider');
      await request(app.getHttpServer()).get(api).set('Authorization', outsider.auth).expect(404);
      await request(app.getHttpServer()).get(api).expect(401);

      // Archived organizations keep their history readable but frozen.
      await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer()).post(api).set('Authorization', owner.auth).expect(423);
      await request(app.getHttpServer()).get(api).set('Authorization', owner.auth).expect(200);
      expect(await database.reportSnapshot.count({ where: { organizationId } })).toBe(1);
    });
  }, 60000);
});
