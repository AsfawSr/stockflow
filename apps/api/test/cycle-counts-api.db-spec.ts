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

describe('Cycle count API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'cycle count integration passphrase';
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
        supplierCatalogPrice: transaction.supplierCatalogPrice,
        cycleCount: transaction.cycleCount,
        cycleCountLine: transaction.cycleCountLine,
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
    const rollback = new Error('Rollback cycle count integration test');
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

  async function registerVerified(app: INestApplication, displayName = 'Count Test User') {
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

  it('opens, lists, and reads counts under warehouse roles', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Count Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Counts ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const location = await authed('post', '/locations').send({ name: 'Count Warehouse' });
      const locationId = location.body.id as string;

      expect((await authed('get', '/cycle-counts').expect(200)).body).toMatchObject({
        items: [],
        total: 0,
      });

      const opened = await authed('post', '/cycle-counts')
        .send({ locationId, note: '  Shelf A  ' })
        .expect(201);
      expect(opened.body).toMatchObject({
        status: 'OPEN',
        note: 'Shelf A',
        completedAt: null,
        location: { id: locationId, name: 'Count Warehouse' },
        createdBy: { displayName: 'Count Owner' },
        completedBy: null,
      });
      const countId = opened.body.id as string;
      await authed('post', '/cycle-counts').send({ locationId }).expect(201);

      await authed('post', '/cycle-counts').send({ locationId: randomUUID() }).expect(404);
      await authed('post', '/cycle-counts').send({ locationId: 'not-a-uuid' }).expect(400);
      const archived = await authed('post', '/locations').send({ name: 'Closed Warehouse' });
      await authed('post', `/locations/${archived.body.id as string}/archive`).expect(200);
      await authed('post', '/cycle-counts')
        .send({ locationId: archived.body.id as string })
        .expect(409);

      const list = await authed('get', '/cycle-counts?page=1&pageSize=1').expect(200);
      expect(list.body.total).toBe(2);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ note: null, lineCount: 0 });
      const lastPage = await authed('get', '/cycle-counts?page=2&pageSize=1').expect(200);
      expect(lastPage.body.items[0]).toMatchObject({ id: countId, note: 'Shelf A' });

      const detail = await authed('get', `/cycle-counts/${countId}`).expect(200);
      expect(detail.body.lines).toEqual([]);
      await authed('get', `/cycle-counts/${randomUUID()}`).expect(404);
      await authed('get', '/cycle-counts/not-a-uuid').expect(404);

      // Warehouse members count stock; managers and outsiders do not.
      const warehouse = await addMember(
        app,
        owner.auth,
        organizationId,
        ['WAREHOUSE'],
        'Count Warehouse User',
      );
      await request(app.getHttpServer())
        .post(`${api}/cycle-counts`)
        .set('Authorization', warehouse.auth)
        .send({ locationId })
        .expect(201);
      const manager = await addMember(
        app,
        owner.auth,
        organizationId,
        ['MANAGER'],
        'Count Manager',
      );
      await request(app.getHttpServer())
        .post(`${api}/cycle-counts`)
        .set('Authorization', manager.auth)
        .send({ locationId })
        .expect(403);
      await request(app.getHttpServer())
        .get(`${api}/cycle-counts`)
        .set('Authorization', manager.auth)
        .expect(200);
      const outsider = await registerVerified(app, 'Count Outsider');
      await request(app.getHttpServer())
        .get(`${api}/cycle-counts`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer()).get(`${api}/cycle-counts`).expect(401);

      const audit = await database.auditEvent.findMany({
        where: { organizationId, action: 'count.opened' },
      });
      expect(audit).toHaveLength(3);
      expect(audit[0].summary).toBe('Opened a cycle count at Count Warehouse');
      expect(audit[0].entityType).toBe('cycle_count');
    });
  }, 60000);

  it('records and corrects counted lines while the session is open', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app, 'Count Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Counts ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const location = await authed('post', '/locations').send({ name: 'Line Warehouse' });
      const locationId = location.body.id as string;
      const charger = await authed('post', '/products').send({
        sku: 'LINE-1',
        name: 'Lined Charger',
        unit: 'piece',
      });
      const chargerId = charger.body.id as string;
      const cable = await authed('post', '/products').send({
        sku: 'LINE-2',
        name: 'Lined Cable',
        unit: 'piece',
      });
      await authed('post', '/stock/adjustments')
        .send({ productId: chargerId, locationId, quantity: 5, reason: 'Opening balance' })
        .expect(201);

      const count = await authed('post', '/cycle-counts').send({ locationId }).expect(201);
      const countId = count.body.id as string;
      const linePath = (productId: string) => `/cycle-counts/${countId}/lines/${productId}`;

      // The expected quantity snapshots the live balance at save time.
      const recorded = await authed('put', linePath(chargerId))
        .send({ countedQuantity: 3 })
        .expect(200);
      expect(recorded.body).toMatchObject({
        expectedQuantity: 5,
        countedQuantity: 3,
        product: { id: chargerId, sku: 'LINE-1' },
      });
      const corrected = await authed('put', linePath(chargerId))
        .send({ countedQuantity: 4 })
        .expect(200);
      expect(corrected.body.id).toBe(recorded.body.id);
      expect(corrected.body.countedQuantity).toBe(4);
      await authed('post', '/stock/adjustments')
        .send({ productId: chargerId, locationId, quantity: 2, reason: 'Late receipt' })
        .expect(201);
      const refreshed = await authed('put', linePath(chargerId))
        .send({ countedQuantity: 4 })
        .expect(200);
      expect(refreshed.body.expectedQuantity).toBe(7);

      // Products with no balance at the location expect zero.
      const empty = await authed('put', linePath(cable.body.id as string))
        .send({ countedQuantity: 1 })
        .expect(200);
      expect(empty.body.expectedQuantity).toBe(0);

      await authed('put', linePath(chargerId)).send({ countedQuantity: -1 }).expect(400);
      await authed('put', linePath(chargerId)).send({ countedQuantity: 'three' }).expect(400);
      await authed('put', linePath(chargerId)).send({}).expect(400);
      await authed('put', linePath(randomUUID())).send({ countedQuantity: 1 }).expect(404);
      await authed('put', `/cycle-counts/${randomUUID()}/lines/${chargerId}`)
        .send({ countedQuantity: 1 })
        .expect(404);
      const retired = await authed('post', '/products').send({
        sku: 'LINE-3',
        name: 'Retired Widget',
        unit: 'piece',
      });
      await authed('post', `/products/${retired.body.id as string}/archive`).expect(200);
      await authed('put', linePath(retired.body.id as string))
        .send({ countedQuantity: 1 })
        .expect(409);

      const detail = await authed('get', `/cycle-counts/${countId}`).expect(200);
      expect(
        detail.body.lines.map((line: { product: { sku: string } }) => line.product.sku),
      ).toEqual(['LINE-2', 'LINE-1']);

      await authed('delete', linePath(cable.body.id as string)).expect(204);
      await authed('delete', linePath(cable.body.id as string)).expect(404);
      expect((await authed('get', `/cycle-counts/${countId}`).expect(200)).body.lines).toHaveLength(
        1,
      );

      const manager = await addMember(app, owner.auth, organizationId, ['MANAGER'], 'Line Manager');
      await request(app.getHttpServer())
        .put(`${api}${linePath(chargerId)}`)
        .set('Authorization', manager.auth)
        .send({ countedQuantity: 2 })
        .expect(403);
    });
  }, 60000);

  it('cancels open counts and freezes them afterwards', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Count Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Counts ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const location = await authed('post', '/locations').send({ name: 'Cancel Warehouse' });
      const locationId = location.body.id as string;
      const product = await authed('post', '/products').send({
        sku: 'CANCEL-1',
        name: 'Cancelled Widget',
        unit: 'piece',
      });
      const productId = product.body.id as string;

      const count = await authed('post', '/cycle-counts').send({ locationId }).expect(201);
      const countId = count.body.id as string;
      await authed('put', `/cycle-counts/${countId}/lines/${productId}`)
        .send({ countedQuantity: 2 })
        .expect(200);

      const cancelled = await authed('post', `/cycle-counts/${countId}/cancel`).expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.completedAt).toBeNull();
      expect(cancelled.body.lines).toHaveLength(1);

      // Cancelled counts reject every further change but stay readable.
      await authed('post', `/cycle-counts/${countId}/cancel`).expect(409);
      await authed('put', `/cycle-counts/${countId}/lines/${productId}`)
        .send({ countedQuantity: 3 })
        .expect(409);
      await authed('delete', `/cycle-counts/${countId}/lines/${productId}`).expect(409);
      await authed('get', `/cycle-counts/${countId}`).expect(200);
      await authed('post', `/cycle-counts/${randomUUID()}/cancel`).expect(404);

      const audit = await database.auditEvent.findMany({
        where: { organizationId, action: 'count.cancelled' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].summary).toBe('Cancelled a cycle count at Cancel Warehouse');

      // Archived organizations freeze even open counts.
      const second = await authed('post', '/cycle-counts').send({ locationId }).expect(201);
      await authed('post', '/archive').expect(200);
      await authed('post', `/cycle-counts/${second.body.id as string}/cancel`).expect(423);
    });
  }, 60000);

  it('turns completion variances into adjustments against live balances', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Count Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Counts ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'put', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const location = await authed('post', '/locations').send({ name: 'Variance Warehouse' });
      const locationId = location.body.id as string;
      const skus = ['OVER-1', 'SHORT-1', 'EXACT-1', 'FRESH-1'];
      const ids: Record<string, string> = {};
      for (const sku of skus) {
        const product = await authed('post', '/products').send({
          sku,
          name: `Counted ${sku}`,
          unit: 'piece',
        });
        ids[sku] = product.body.id as string;
      }
      for (const [sku, quantity] of [
        ['OVER-1', 5],
        ['SHORT-1', 5],
        ['EXACT-1', 5],
      ] as const) {
        await authed('post', '/stock/adjustments')
          .send({ productId: ids[sku], locationId, quantity, reason: 'Opening balance' })
          .expect(201);
      }

      const count = await authed('post', '/cycle-counts')
        .send({ locationId, note: 'Friday sweep' })
        .expect(201);
      const countId = count.body.id as string;
      const record = (sku: string, countedQuantity: number) =>
        authed('put', `/cycle-counts/${countId}/lines/${ids[sku]}`).send({ countedQuantity });

      // An empty session has nothing to post.
      await authed('post', `/cycle-counts/${countId}/complete`).expect(400);

      await record('OVER-1', 8).expect(200);
      await record('SHORT-1', 2).expect(200);
      await record('EXACT-1', 5).expect(200);
      await record('FRESH-1', 3).expect(200);
      // The ledger moves after the count was recorded; completion trusts the live balance.
      await authed('post', '/stock/adjustments')
        .send({ productId: ids['EXACT-1'], locationId, quantity: 1, reason: 'Late receipt' })
        .expect(201);

      const completed = await authed('post', `/cycle-counts/${countId}/complete`).expect(200);
      expect(completed.body.status).toBe('COMPLETED');
      expect(completed.body.completedAt).toBeTruthy();
      expect(completed.body.completedBy.displayName).toBe('Count Owner');
      const bySku = Object.fromEntries(
        completed.body.lines.map((line: { product: { sku: string } }) => [line.product.sku, line]),
      );
      // Expectations are refreshed to the balance the variance was posted against.
      expect(bySku['OVER-1']).toMatchObject({ expectedQuantity: 5, countedQuantity: 8 });
      expect(bySku['SHORT-1']).toMatchObject({ expectedQuantity: 5, countedQuantity: 2 });
      expect(bySku['EXACT-1']).toMatchObject({ expectedQuantity: 6, countedQuantity: 5 });
      expect(bySku['FRESH-1']).toMatchObject({ expectedQuantity: 0, countedQuantity: 3 });

      const levels = await authed('get', '/stock/levels?pageSize=100').expect(200);
      const levelBySku = Object.fromEntries(
        levels.body.items.map((item: { product: { sku: string }; quantity: number }) => [
          item.product.sku,
          item.quantity,
        ]),
      );
      expect(levelBySku['OVER-1']).toBe(8);
      expect(levelBySku['SHORT-1']).toBe(2);
      expect(levelBySku['EXACT-1']).toBe(5);
      expect(levelBySku['FRESH-1']).toBe(3);

      // Four variances, one match: adjustments and movements line up.
      const adjustments = await database.stockAdjustment.findMany({
        where: { organizationId, reason: 'Cycle count at Variance Warehouse' },
      });
      expect(adjustments).toHaveLength(4);
      const adjustmentBy = new Map(adjustments.map((row) => [row.productId, row.quantity]));
      expect(adjustmentBy.get(ids['OVER-1'])).toBe(3);
      expect(adjustmentBy.get(ids['SHORT-1'])).toBe(-3);
      expect(adjustmentBy.get(ids['EXACT-1'])).toBe(-1);
      expect(adjustmentBy.get(ids['FRESH-1'])).toBe(3);
      expect(
        await database.stockMovement.count({
          where: { organizationId, type: 'ADJUSTMENT', stockAdjustmentId: { not: null } },
        }),
      ).toBe(8);

      // Completed counts freeze like cancelled ones.
      await authed('post', `/cycle-counts/${countId}/complete`).expect(409);
      await record('OVER-1', 9).expect(409);

      const audit = await database.auditEvent.findMany({
        where: { organizationId, action: 'count.completed' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].summary).toBe(
        'Completed a cycle count at Variance Warehouse with 4 adjustments',
      );
      expect(audit[0].entityId).toBe(countId);
    });
  }, 60000);
});
