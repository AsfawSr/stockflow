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

describe('Purchase order workflow against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'purchase order integration passphrase';
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

  function testingModule(database: Prisma.TransactionClient | PrismaService) {
    let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(
      AccountMailer,
    );
    const withMailer = builder.useValue({
      webOrigin: 'http://127.0.0.1:3000',
      send: async (mail: AccountEmail) => {
        if (failNextMail) {
          failNextMail = false;
          throw new Error('Simulated mail outage');
        }
        outbox.push(mail);
      },
    });
    if (database === prisma) return withMailer;
    const transaction = database as Prisma.TransactionClient;
    return withMailer.overrideProvider(PrismaService).useValue({
      user: transaction.user,
      session: transaction.session,
      organization: transaction.organization,
      membership: transaction.membership,
      accountToken: transaction.accountToken,
      auditEvent: transaction.auditEvent,
      product: transaction.product,
      supplier: transaction.supplier,
      location: transaction.location,
      purchaseOrder: transaction.purchaseOrder,
      purchaseOrderLine: transaction.purchaseOrderLine,
      goodsReceipt: transaction.goodsReceipt,
      goodsReceiptLine: transaction.goodsReceiptLine,
      stockMovement: transaction.stockMovement,
      stockLevel: transaction.stockLevel,
      $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(transaction),
      $queryRaw: transaction.$queryRaw.bind(transaction),
    });
  }

  async function buildApp(database: Prisma.TransactionClient | PrismaService) {
    const module = await testingModule(database).compile();
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
    const rollback = new Error('Rollback purchase order integration test');
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

  async function registerVerified(app: INestApplication) {
    const email = `${randomUUID()}@example.test`;
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Order Test User' })
      .expect(201);
    const message = outbox.findLast((mail) => mail.to === email);
    if (!message) throw new Error('Verification email was not captured.');
    const token = new URLSearchParams(new URL(message.actionUrl!).hash.slice(1)).get('token')!;
    await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
    return { auth: `Bearer ${response.body.accessToken as string}`, email };
  }

  type Api = { app: INestApplication; auth: string };

  async function seedOrganization(app: INestApplication, auth: string) {
    const organization = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', auth)
      .send({ name: `Orders ${randomUUID().slice(0, 8)}`, currency: 'USD' })
      .expect(201);
    const organizationId = organization.body.id as string;
    const supplier = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/suppliers`)
      .set('Authorization', auth)
      .send({ name: 'Order Supplier' })
      .expect(201);
    const location = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/locations`)
      .set('Authorization', auth)
      .send({ name: 'Order Warehouse' })
      .expect(201);
    const charger = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/products`)
      .set('Authorization', auth)
      .send({ sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' })
      .expect(201);
    const cable = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/products`)
      .set('Authorization', auth)
      .send({ sku: 'CABLE-2M', name: 'HDMI Cable', unit: 'piece' })
      .expect(201);
    return {
      organizationId,
      supplierId: supplier.body.id as string,
      locationId: location.body.id as string,
      chargerId: charger.body.id as string,
      cableId: cable.body.id as string,
    };
  }

  async function addMember(
    database: Prisma.TransactionClient,
    app: INestApplication,
    organizationId: string,
    roles: string[],
  ): Promise<Api> {
    const member = await registerVerified(app);
    const account = await database.user.findUniqueOrThrow({
      where: { email: member.email },
      select: { id: true },
    });
    await database.membership.create({
      data: {
        organizationId,
        userId: account.id,
        roles: roles as never,
      },
    });
    return { app, auth: member.auth };
  }

  it('runs the full workflow from draft to received with an auditable ledger', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const seed = await seedOrganization(app, owner.auth);
      const base = `/api/organizations/${seed.organizationId}/purchase-orders`;
      const purchaser = await addMember(database, app, seed.organizationId, ['PURCHASER']);
      const manager = await addMember(database, app, seed.organizationId, ['MANAGER']);
      const warehouse = await addMember(database, app, seed.organizationId, ['WAREHOUSE']);

      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', purchaser.auth)
        .send({
          supplierId: seed.supplierId,
          locationId: seed.locationId,
          note: ' Urgent restock ',
        })
        .expect(201);
      const orderId = created.body.id as string;
      expect(created.body).toMatchObject({
        reference: 'PO-0001',
        status: 'DRAFT',
        note: 'Urgent restock',
        total: '0.00',
      });

      const second = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', purchaser.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(201);
      expect(second.body.number).toBe(2);

      await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', purchaser.auth)
        .send({ productId: seed.chargerId, quantity: 100, unitPrice: '25.50' })
        .expect(201);
      const withCable = await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', purchaser.auth)
        .send({ productId: seed.cableId, quantity: 5, unitPrice: '3' })
        .expect(201);
      const cableLineId = withCable.body.lines.find(
        (line: { product: { id: string } }) => line.product.id === seed.cableId,
      ).id as string;
      const updatedLine = await request(app.getHttpServer())
        .patch(`${base}/${orderId}/lines/${cableLineId}`)
        .set('Authorization', purchaser.auth)
        .send({ quantity: 10, unitPrice: '2.50' })
        .expect(200);
      expect(updatedLine.body.total).toBe('2575.00');

      const submitted = await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', purchaser.auth)
        .expect(200);
      expect(submitted.body.status).toBe('SUBMITTED');

      const approved = await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', manager.auth)
        .send({ note: 'Within budget' })
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.decidedBy.displayName).toBe('Order Test User');
      expect(approved.body.decisionNote).toBe('Within budget');

      const chargerLineId = approved.body.lines.find(
        (line: { product: { id: string } }) => line.product.id === seed.chargerId,
      ).id as string;
      const firstReceipt = await request(app.getHttpServer())
        .post(`${base}/${orderId}/receipts`)
        .set('Authorization', warehouse.auth)
        .send({
          note: 'First delivery',
          lines: [
            { purchaseOrderLineId: chargerLineId, quantity: 60 },
            { purchaseOrderLineId: cableLineId, quantity: 10 },
          ],
        })
        .expect(201);
      expect(firstReceipt.body.status).toBe('PARTIALLY_RECEIVED');
      const chargerLine = firstReceipt.body.lines.find(
        (line: { id: string }) => line.id === chargerLineId,
      );
      expect(chargerLine.receivedQuantity).toBe(60);
      expect(chargerLine.remainingQuantity).toBe(40);

      const chargerStock = await database.stockLevel.findUniqueOrThrow({
        where: {
          organizationId_productId_locationId: {
            organizationId: seed.organizationId,
            productId: seed.chargerId,
            locationId: seed.locationId,
          },
        },
      });
      expect(chargerStock.quantity).toBe(60);
      expect(
        await database.stockMovement.count({
          where: { organizationId: seed.organizationId, type: 'RECEIPT' },
        }),
      ).toBe(2);

      const finalReceipt = await request(app.getHttpServer())
        .post(`${base}/${orderId}/receipts`)
        .set('Authorization', warehouse.auth)
        .send({ lines: [{ purchaseOrderLineId: chargerLineId, quantity: 40 }] })
        .expect(201);
      expect(finalReceipt.body.status).toBe('RECEIVED');
      expect(finalReceipt.body.receipts).toHaveLength(2);
      expect(
        (
          await database.stockLevel.findUniqueOrThrow({
            where: {
              organizationId_productId_locationId: {
                organizationId: seed.organizationId,
                productId: seed.chargerId,
                locationId: seed.locationId,
              },
            },
          })
        ).quantity,
      ).toBe(100);

      const listed = await request(app.getHttpServer())
        .get(`${base}?status=RECEIVED`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(listed.body.total).toBe(1);
      expect(listed.body.items[0]).toMatchObject({ reference: 'PO-0001', total: '2575.00' });
    });
  }, 60000);

  it('enforces the state machine and receipt bounds', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const seed = await seedOrganization(app, owner.auth);
      const base = `/api/organizations/${seed.organizationId}/purchase-orders`;

      const draft = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(201);
      const orderId = draft.body.id as string;

      const emptySubmit = await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', owner.auth)
        .expect(409);
      expect(emptySubmit.body.message).toBe('Add at least one line before submitting.');

      await request(app.getHttpServer())
        .post(`${base}/${orderId}/receipts`)
        .set('Authorization', owner.auth)
        .send({ lines: [{ purchaseOrderLineId: randomUUID(), quantity: 1 }] })
        .expect(409);

      const line = await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.chargerId, quantity: 10, unitPrice: '5.00' })
        .expect(201);
      const lineId = line.body.lines[0].id as string;
      await database.$executeRaw`SAVEPOINT duplicate_order_line`;
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.chargerId, quantity: 4, unitPrice: '5.00' })
        .expect(409);
      await database.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_order_line`;
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(409);

      await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`${base}/${orderId}`)
        .set('Authorization', owner.auth)
        .send({ note: 'Editing submitted order' })
        .expect(409);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.cableId, quantity: 1, unitPrice: '1' })
        .expect(409);
      await request(app.getHttpServer())
        .patch(`${base}/${orderId}/lines/${lineId}`)
        .set('Authorization', owner.auth)
        .send({ quantity: 5 })
        .expect(409);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/reject`)
        .set('Authorization', owner.auth)
        .send({ note: '   ' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/reject`)
        .set('Authorization', owner.auth)
        .send({ note: 'Budget exceeded' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(409);

      // A fresh approved order for receipt bound checks.
      const order = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(201);
      const secondId = order.body.id as string;
      const added = await request(app.getHttpServer())
        .post(`${base}/${secondId}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.chargerId, quantity: 10, unitPrice: '5.00' })
        .expect(201);
      const secondLineId = added.body.lines[0].id as string;
      await request(app.getHttpServer())
        .post(`${base}/${secondId}/submit`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${secondId}/approve`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .post(`${base}/${secondId}/receipts`)
        .set('Authorization', owner.auth)
        .send({
          lines: [
            { purchaseOrderLineId: secondLineId, quantity: 1 },
            { purchaseOrderLineId: secondLineId, quantity: 2 },
          ],
        })
        .expect(400);
      const overReceipt = await request(app.getHttpServer())
        .post(`${base}/${secondId}/receipts`)
        .set('Authorization', owner.auth)
        .send({ lines: [{ purchaseOrderLineId: secondLineId, quantity: 11 }] })
        .expect(409);
      expect(overReceipt.body.message).toContain('Remaining: 10');
      await request(app.getHttpServer())
        .post(`${base}/${secondId}/receipts`)
        .set('Authorization', owner.auth)
        .send({ lines: [{ purchaseOrderLineId: secondLineId, quantity: 4 }] })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${base}/${secondId}/receipts`)
        .set('Authorization', owner.auth)
        .send({ lines: [{ purchaseOrderLineId: secondLineId, quantity: 7 }] })
        .expect(409);
      const cancelAfterReceipt = await request(app.getHttpServer())
        .post(`${base}/${secondId}/cancel`)
        .set('Authorization', owner.auth)
        .expect(409);
      expect(cancelAfterReceipt.body.message).toBe(
        'Orders with recorded deliveries cannot be cancelled.',
      );

      // Archived partners cannot start new orders.
      await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/suppliers/${seed.supplierId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(409);
      await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/products/${seed.cableId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      const third = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({
          supplierId: (
            await database.supplier.create({
              data: { organizationId: seed.organizationId, name: 'Replacement Supplier' },
              select: { id: true },
            })
          ).id,
          locationId: seed.locationId,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${base}/${third.body.id}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.cableId, quantity: 1, unitPrice: '1' })
        .expect(409);
      const cancelled = await request(app.getHttpServer())
        .post(`${base}/${third.body.id}/cancel`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
    });
  }, 60000);

  it('enforces roles and organization isolation', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const outsider = await registerVerified(app);
      const seed = await seedOrganization(app, owner.auth);
      const base = `/api/organizations/${seed.organizationId}/purchase-orders`;
      const purchaser = await addMember(database, app, seed.organizationId, ['PURCHASER']);
      const manager = await addMember(database, app, seed.organizationId, ['MANAGER']);
      const warehouse = await addMember(database, app, seed.organizationId, ['WAREHOUSE']);

      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', purchaser.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(201);
      const orderId = created.body.id as string;
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', purchaser.auth)
        .send({ productId: seed.chargerId, quantity: 5, unitPrice: '9.99' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', purchaser.auth)
        .expect(200);

      await request(app.getHttpServer()).get(base).expect(401);
      await request(app.getHttpServer()).get(base).set('Authorization', outsider.auth).expect(404);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', outsider.auth)
        .send({})
        .expect(404);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', manager.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(403);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', warehouse.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', purchaser.auth)
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', warehouse.auth)
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', manager.auth)
        .send({})
        .expect(200);
      const managerLine = (
        await request(app.getHttpServer())
          .get(`${base}/${orderId}`)
          .set('Authorization', warehouse.auth)
          .expect(200)
      ).body.lines[0].id as string;
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/receipts`)
        .set('Authorization', purchaser.auth)
        .send({ lines: [{ purchaseOrderLineId: managerLine, quantity: 1 }] })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/receipts`)
        .set('Authorization', manager.auth)
        .send({ lines: [{ purchaseOrderLineId: managerLine, quantity: 1 }] })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/receipts`)
        .set('Authorization', warehouse.auth)
        .send({ lines: [{ purchaseOrderLineId: managerLine, quantity: 1 }] })
        .expect(201);
    });
  }, 60000);

  it('serializes concurrent receipts and order numbering on committed data', async () => {
    outbox.length = 0;
    const app = await buildApp(prisma);
    const organizationIds: string[] = [];
    const userEmails: string[] = [];
    try {
      const email = `${randomUUID()}@example.test`;
      userEmails.push(email);
      const registered = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, displayName: 'Concurrent Order User' })
        .expect(201);
      const message = outbox.findLast((mail) => mail.to === email)!;
      const token = new URLSearchParams(new URL(message.actionUrl!).hash.slice(1)).get('token')!;
      await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
      const auth = `Bearer ${registered.body.accessToken as string}`;

      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', auth)
        .send({ name: `Concurrency ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      organizationIds.push(organizationId);
      const base = `/api/organizations/${organizationId}/purchase-orders`;
      const supplier = await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/suppliers`)
        .set('Authorization', auth)
        .send({ name: 'Concurrent Supplier' })
        .expect(201);
      const location = await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/locations`)
        .set('Authorization', auth)
        .send({ name: 'Concurrent Warehouse' })
        .expect(201);
      const product = await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/products`)
        .set('Authorization', auth)
        .send({ sku: 'CONC-01', name: 'Concurrent Product', unit: 'piece' })
        .expect(201);

      const [firstOrder, secondOrder] = await Promise.all([
        request(app.getHttpServer())
          .post(base)
          .set('Authorization', auth)
          .send({ supplierId: supplier.body.id, locationId: location.body.id }),
        request(app.getHttpServer())
          .post(base)
          .set('Authorization', auth)
          .send({ supplierId: supplier.body.id, locationId: location.body.id }),
      ]);
      expect(firstOrder.status).toBe(201);
      expect(secondOrder.status).toBe(201);
      expect(new Set([firstOrder.body.number, secondOrder.body.number]).size).toBe(2);

      const orderId = firstOrder.body.id as string;
      const line = await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', auth)
        .send({ productId: product.body.id, quantity: 10, unitPrice: '4.00' })
        .expect(201);
      const lineId = line.body.lines[0].id as string;
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', auth)
        .send({})
        .expect(200);

      const receipts = await Promise.all([
        request(app.getHttpServer())
          .post(`${base}/${orderId}/receipts`)
          .set('Authorization', auth)
          .send({ lines: [{ purchaseOrderLineId: lineId, quantity: 10 }] }),
        request(app.getHttpServer())
          .post(`${base}/${orderId}/receipts`)
          .set('Authorization', auth)
          .send({ lines: [{ purchaseOrderLineId: lineId, quantity: 10 }] }),
      ]);
      const statuses = receipts.map((response) => response.status).sort();
      expect(statuses).toEqual([201, 409]);
      const stock = await prisma.stockLevel.findUniqueOrThrow({
        where: {
          organizationId_productId_locationId: {
            organizationId,
            productId: product.body.id,
            locationId: location.body.id,
          },
        },
      });
      expect(stock.quantity).toBe(10);
      const storedLine = await prisma.purchaseOrderLine.findUniqueOrThrow({
        where: { id: lineId },
      });
      expect(storedLine.receivedQuantity).toBe(10);
    } finally {
      await prisma.stockMovement.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.stockLevel.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.goodsReceiptLine.deleteMany({
        where: { receipt: { organizationId: { in: organizationIds } } },
      });
      await prisma.goodsReceipt.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.purchaseOrderLine.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.purchaseOrder.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.product.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.supplier.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.location.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.membership.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.auditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
      await app.close();
    }
  }, 60000);

  it('reports the latest confirmed supplier prices for order pre-fill', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const seed = await seedOrganization(app, owner.auth);
      const base = `/api/organizations/${seed.organizationId}/purchase-orders`;
      const pricesUrl = `/api/organizations/${seed.organizationId}/suppliers/${seed.supplierId}/prices`;
      const getPrices = (auth = owner.auth) =>
        request(app.getHttpServer()).get(pricesUrl).set('Authorization', auth);
      const createOrder = async () => {
        const created = await request(app.getHttpServer())
          .post(base)
          .set('Authorization', owner.auth)
          .send({ supplierId: seed.supplierId, locationId: seed.locationId })
          .expect(201);
        return created.body.id as string;
      };
      const addLine = (orderId: string, productId: string, unitPrice: string) =>
        request(app.getHttpServer())
          .post(`${base}/${orderId}/lines`)
          .set('Authorization', owner.auth)
          .send({ productId, quantity: 5, unitPrice })
          .expect(201);
      const transition = (orderId: string, action: string, body: object = {}) =>
        request(app.getHttpServer())
          .post(`${base}/${orderId}/${action}`)
          .set('Authorization', owner.auth)
          .send(body)
          .expect(200);

      const empty = await getPrices().expect(200);
      expect(empty.body.items).toEqual([]);

      const first = await createOrder();
      await addLine(first, seed.chargerId, '10');
      expect((await getPrices().expect(200)).body.items).toEqual([]);
      await transition(first, 'submit');
      expect((await getPrices().expect(200)).body.items).toEqual([]);
      await transition(first, 'approve');
      const confirmed = await getPrices().expect(200);
      expect(confirmed.body.items).toEqual([
        {
          product: { id: seed.chargerId, sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' },
          unitPrice: '10.00',
          reference: 'PO-0001',
          decidedAt: expect.any(String),
        },
      ]);

      const second = await createOrder();
      await addLine(second, seed.chargerId, '12.50');
      await addLine(second, seed.cableId, '5');
      await transition(second, 'submit');
      await transition(second, 'approve');
      // Deterministic recency regardless of approval timestamps sharing a millisecond.
      await database.purchaseOrder.update({
        where: { id: first },
        data: { decidedAt: new Date(Date.now() - 3600000) },
      });
      const latest = await getPrices().expect(200);
      expect(
        latest.body.items.map(
          (item: { product: { sku: string }; unitPrice: string; reference: string }) => [
            item.product.sku,
            item.unitPrice,
            item.reference,
          ],
        ),
      ).toEqual([
        ['CABLE-2M', '5.00', 'PO-0002'],
        ['CHARGER-65', '12.50', 'PO-0002'],
      ]);

      // Rejected negotiations never overwrite confirmed prices.
      const third = await createOrder();
      await addLine(third, seed.chargerId, '99.99');
      await transition(third, 'submit');
      await transition(third, 'reject', { note: 'Too expensive' });
      const afterReject = await getPrices().expect(200);
      expect(
        afterReject.body.items.find(
          (item: { product: { sku: string } }) => item.product.sku === 'CHARGER-65',
        ).unitPrice,
      ).toBe('12.50');

      await request(app.getHttpServer()).get(pricesUrl).expect(401);
      const outsider = await registerVerified(app);
      await getPrices(outsider.auth).expect(404);
      await request(app.getHttpServer())
        .get(`/api/organizations/${seed.organizationId}/suppliers/${randomUUID()}/prices`)
        .set('Authorization', owner.auth)
        .expect(404);
      const otherSupplier = await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/suppliers`)
        .set('Authorization', owner.auth)
        .send({ name: 'Second Supplier' })
        .expect(201);
      const otherPrices = await request(app.getHttpServer())
        .get(`/api/organizations/${seed.organizationId}/suppliers/${otherSupplier.body.id}/prices`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(otherPrices.body.items).toEqual([]);
    });
  }, 60000);

  it('suggests restocking low products from the last confirmed source', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app);
      const seed = await seedOrganization(app, owner.auth);
      const base = `/api/organizations/${seed.organizationId}/purchase-orders`;
      const suggestionsUrl = `${base}/suggestions`;
      const getSuggestions = (auth = owner.auth) =>
        request(app.getHttpServer()).get(suggestionsUrl).set('Authorization', auth);

      // No reorder points yet, so nothing to suggest.
      expect((await getSuggestions().expect(200)).body.items).toEqual([]);

      await request(app.getHttpServer())
        .patch(`/api/organizations/${seed.organizationId}/products/${seed.chargerId}`)
        .set('Authorization', owner.auth)
        .send({ reorderPoint: 10 })
        .expect(200);
      const bare = await getSuggestions().expect(200);
      expect(bare.body.items).toEqual([
        {
          product: { id: seed.chargerId, sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' },
          reorderPoint: 10,
          onHand: 0,
          suggestedQuantity: 20,
          supplier: null,
          unitPrice: null,
          reference: null,
        },
      ]);

      // A confirmed order attaches the supplier and price; its receipt raises on-hand.
      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(201);
      const orderId = created.body.id as string;
      const withLine = await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.chargerId, quantity: 4, unitPrice: '7.50' })
        .expect(201);
      const lineId = withLine.body.lines[0].id as string;
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/receipts`)
        .set('Authorization', owner.auth)
        .send({ lines: [{ purchaseOrderLineId: lineId, quantity: 4 }] })
        .expect(201);
      const sourced = await getSuggestions().expect(200);
      expect(sourced.body.items).toEqual([
        {
          product: { id: seed.chargerId, sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' },
          reorderPoint: 10,
          onHand: 4,
          suggestedQuantity: 16,
          supplier: { id: seed.supplierId, name: 'Order Supplier' },
          unitPrice: '7.50',
          reference: 'PO-0001',
        },
      ]);

      // An archived supplier is never proposed, but the shortage still shows.
      await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/suppliers/${seed.supplierId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      const archivedSupplier = await getSuggestions().expect(200);
      expect(archivedSupplier.body.items[0]).toMatchObject({
        supplier: null,
        unitPrice: null,
        reference: null,
        suggestedQuantity: 16,
      });
      await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/suppliers/${seed.supplierId}/restore`)
        .set('Authorization', owner.auth)
        .expect(200);

      // Stock above the reorder point and archived products drop out.
      await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/stock/adjustments`)
        .set('Authorization', owner.auth)
        .send({
          productId: seed.chargerId,
          locationId: seed.locationId,
          quantity: 7,
          reason: 'Found stock',
        })
        .expect(201);
      expect((await getSuggestions().expect(200)).body.items).toEqual([]);
      await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/stock/adjustments`)
        .set('Authorization', owner.auth)
        .send({
          productId: seed.chargerId,
          locationId: seed.locationId,
          quantity: -5,
          reason: 'Recount',
        })
        .expect(201);
      expect((await getSuggestions().expect(200)).body.items).toHaveLength(1);
      await request(app.getHttpServer())
        .post(`/api/organizations/${seed.organizationId}/products/${seed.chargerId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect((await getSuggestions().expect(200)).body.items).toEqual([]);

      await request(app.getHttpServer()).get(suggestionsUrl).expect(401);
      const outsider = await registerVerified(app);
      await getSuggestions(outsider.auth).expect(404);
    });
  }, 60000);

  it('reopens rejected orders as drafts for revision and resubmission', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const seed = await seedOrganization(app, owner.auth);
      const base = `/api/organizations/${seed.organizationId}/purchase-orders`;

      const draft = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(201);
      const orderId = draft.body.id as string;
      const line = await request(app.getHttpServer())
        .post(`${base}/${orderId}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.chargerId, quantity: 10, unitPrice: '5.00' })
        .expect(201);
      const lineId = line.body.lines[0].id as string;

      // Only rejected orders can be revised.
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/revise`)
        .set('Authorization', owner.auth)
        .expect(409);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/revise`)
        .set('Authorization', owner.auth)
        .expect(409);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/reject`)
        .set('Authorization', owner.auth)
        .send({ note: 'Budget exceeded' })
        .expect(200);

      // Reviewers without purchasing rights cannot reopen; outsiders see nothing.
      const warehouse = await addMember(database, app, seed.organizationId, ['WAREHOUSE']);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/revise`)
        .set('Authorization', warehouse.auth)
        .expect(403);
      const outsider = await registerVerified(app);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/revise`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer()).post(`${base}/${orderId}/revise`).expect(401);

      const revised = await request(app.getHttpServer())
        .post(`${base}/${orderId}/revise`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(revised.body.status).toBe('DRAFT');
      expect(revised.body.decidedBy).toBeNull();
      expect(revised.body.decidedAt).toBeNull();
      expect(revised.body.decisionNote).toBeNull();
      expect(revised.body.lines).toHaveLength(1);

      // The reopened draft is fully editable and goes through approval again.
      await request(app.getHttpServer())
        .patch(`${base}/${orderId}/lines/${lineId}`)
        .set('Authorization', owner.auth)
        .send({ quantity: 5, unitPrice: '4.50' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/submit`)
        .set('Authorization', owner.auth)
        .expect(200);
      const approved = await request(app.getHttpServer())
        .post(`${base}/${orderId}/approve`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.total).toBe('22.50');

      // Approved and cancelled orders stay closed to revision.
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/revise`)
        .set('Authorization', owner.auth)
        .expect(409);
      await request(app.getHttpServer())
        .post(`${base}/${orderId}/cancel`)
        .set('Authorization', owner.auth)
        .expect(200);
      const closed = await request(app.getHttpServer())
        .post(`${base}/${orderId}/revise`)
        .set('Authorization', owner.auth)
        .expect(409);
      expect(closed.body.message).toContain('rejected');
    });
  }, 60000);

  it('emails approved orders to supplier contacts without blocking approval', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app);
      const seed = await seedOrganization(app, owner.auth);
      const base = `/api/organizations/${seed.organizationId}/purchase-orders`;
      const approveOrder = async (note?: string) => {
        const draft = await request(app.getHttpServer())
          .post(base)
          .set('Authorization', owner.auth)
          .send({ supplierId: seed.supplierId, locationId: seed.locationId, note: note ?? null })
          .expect(201);
        const orderId = draft.body.id as string;
        await request(app.getHttpServer())
          .post(`${base}/${orderId}/lines`)
          .set('Authorization', owner.auth)
          .send({ productId: seed.chargerId, quantity: 3, unitPrice: '19.99' })
          .expect(201);
        await request(app.getHttpServer())
          .post(`${base}/${orderId}/submit`)
          .set('Authorization', owner.auth)
          .expect(200);
        return request(app.getHttpServer())
          .post(`${base}/${orderId}/approve`)
          .set('Authorization', owner.auth)
          .send({})
          .expect(200);
      };

      // Suppliers without a contact address are silently skipped.
      const quietBefore = outbox.length;
      await approveOrder();
      expect(outbox.length).toBe(quietBefore);

      await request(app.getHttpServer())
        .patch(`/api/organizations/${seed.organizationId}/suppliers/${seed.supplierId}`)
        .set('Authorization', owner.auth)
        .send({ email: 'orders@supplier.test' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/organizations/${seed.organizationId}/locations/${seed.locationId}`)
        .set('Authorization', owner.auth)
        .send({ address: 'Dock 4' })
        .expect(200);

      await approveOrder('Deliver before Friday');
      const message = outbox.findLast((mail) => mail.to === 'orders@supplier.test');
      if (!message) throw new Error('Supplier order email was not captured.');
      expect(message.subject).toContain('Purchase order PO-0002 from Orders ');
      expect(message.actionUrl).toBeUndefined();
      expect(message.text).toContain('Hello Order Supplier,');
      expect(message.text).toContain('- USB-C Charger (CHARGER-65): 3 piece @ 19.99 = 59.97');
      expect(message.text).toContain('Total: 59.97 USD');
      expect(message.text).toContain('Deliver to: Order Warehouse, Dock 4');
      expect(message.text).toContain('Note: Deliver before Friday');

      // A mail outage must not roll back the decision.
      const outageBefore = outbox.length;
      failNextMail = true;
      const approved = await approveOrder();
      expect(approved.body.status).toBe('APPROVED');
      expect(outbox.length).toBe(outageBefore);

      // Rejection never notifies the supplier.
      const draft = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ supplierId: seed.supplierId, locationId: seed.locationId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${base}/${draft.body.id}/lines`)
        .set('Authorization', owner.auth)
        .send({ productId: seed.cableId, quantity: 1, unitPrice: '2.00' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${base}/${draft.body.id}/submit`)
        .set('Authorization', owner.auth)
        .expect(200);
      const rejectBefore = outbox.length;
      await request(app.getHttpServer())
        .post(`${base}/${draft.body.id}/reject`)
        .set('Authorization', owner.auth)
        .send({ note: 'Not needed' })
        .expect(200);
      expect(outbox.length).toBe(rejectBefore);
    });
  }, 60000);
});
