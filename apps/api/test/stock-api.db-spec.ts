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

describe('Stock APIs against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'stock integration passphrase';
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
        product: transaction.product,
        supplier: transaction.supplier,
        location: transaction.location,
        stockLevel: transaction.stockLevel,
        stockMovement: transaction.stockMovement,
        stockTransfer: transaction.stockTransfer,
        stockAdjustment: transaction.stockAdjustment,
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
    const rollback = new Error('Rollback stock integration test');
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
      .send({ email, password, displayName: 'Stock Test User' })
      .expect(201);
    const message = outbox.findLast((mail) => mail.to === email);
    if (!message) throw new Error('Verification email was not captured.');
    const token = new URLSearchParams(new URL(message.actionUrl).hash.slice(1)).get('token')!;
    await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
    return { auth: `Bearer ${response.body.accessToken as string}`, email };
  }

  async function seed(app: INestApplication, auth: string) {
    const organization = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', auth)
      .send({ name: `Stock ${randomUUID().slice(0, 8)}`, currency: 'USD' })
      .expect(201);
    const organizationId = organization.body.id as string;
    const product = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/products`)
      .set('Authorization', auth)
      .send({ sku: 'STOCK-01', name: 'Stock Product', unit: 'piece' })
      .expect(201);
    const main = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/locations`)
      .set('Authorization', auth)
      .send({ name: 'Main Warehouse' })
      .expect(201);
    const store = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/locations`)
      .set('Authorization', auth)
      .send({ name: 'Retail Store' })
      .expect(201);
    return {
      organizationId,
      productId: product.body.id as string,
      mainId: main.body.id as string,
      storeId: store.body.id as string,
      base: `/api/organizations/${organizationId}/stock`,
    };
  }

  it('records adjustments and transfers and reports levels and movement history', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app);
      const seedData = await seed(app, owner.auth);
      const { base, productId, mainId, storeId } = seedData;

      const opening = await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: 10, reason: ' Opening balance ' })
        .expect(201);
      expect(opening.body.levels).toEqual([{ locationId: mainId, quantity: 10 }]);

      const transfer = await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', owner.auth)
        .send({
          productId,
          fromLocationId: mainId,
          toLocationId: storeId,
          quantity: 4,
          note: 'Restock shelf',
        })
        .expect(201);
      expect(
        new Map(
          transfer.body.levels.map((level: { locationId: string; quantity: number }) => [
            level.locationId,
            level.quantity,
          ]),
        ),
      ).toEqual(
        new Map([
          [mainId, 6],
          [storeId, 4],
        ]),
      );

      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: -1, reason: 'Damaged unit' })
        .expect(201);

      const levels = await request(app.getHttpServer())
        .get(`${base}/levels`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(levels.body.total).toBe(2);
      expect(levels.body.items).toMatchObject([
        { product: { sku: 'STOCK-01' }, location: { name: 'Main Warehouse' }, quantity: 5 },
        { product: { sku: 'STOCK-01' }, location: { name: 'Retail Store' }, quantity: 4 },
      ]);

      const filtered = await request(app.getHttpServer())
        .get(`${base}/levels?locationId=${storeId}&search=stock`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0].quantity).toBe(4);

      const movements = await request(app.getHttpServer())
        .get(`${base}/movements`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(movements.body.total).toBe(4);
      expect(movements.body.items.map((item: { type: string }) => item.type)).toEqual([
        'ADJUSTMENT',
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'ADJUSTMENT',
      ]);
      expect(movements.body.items[0].detail).toBe('Damaged unit');
      expect(movements.body.items[1].detail).toBe('Main Warehouse to Retail Store - Restock shelf');
      expect(movements.body.items[1].quantity).toBe(4);
      expect(movements.body.items[2].quantity).toBe(-4);
      expect(movements.body.items[3].detail).toBe('Opening balance');

      const storeMovements = await request(app.getHttpServer())
        .get(`${base}/movements?locationId=${storeId}`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(storeMovements.body.total).toBe(1);
      expect(storeMovements.body.items[0].type).toBe('TRANSFER_IN');

      // Low-stock flags and the low-only report follow the product's reorder point.
      expect(levels.body.items.map((item: { low: boolean }) => item.low)).toEqual([false, false]);
      await request(app.getHttpServer())
        .patch(`/api/organizations/${seedData.organizationId}/products/${productId}`)
        .set('Authorization', owner.auth)
        .send({ reorderPoint: 4 })
        .expect(200);
      const flagged = await request(app.getHttpServer())
        .get(`${base}/levels`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(
        flagged.body.items.map((item: { quantity: number; low: boolean }) => [
          item.quantity,
          item.low,
        ]),
      ).toEqual([
        [5, false],
        [4, true],
      ]);
      const lowOnly = await request(app.getHttpServer())
        .get(`${base}/levels?low=true`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(lowOnly.body.total).toBe(1);
      expect(lowOnly.body.items[0]).toMatchObject({
        quantity: 4,
        low: true,
        location: { name: 'Retail Store' },
        product: { sku: 'STOCK-01', reorderPoint: 4 },
      });
      const lowElsewhere = await request(app.getHttpServer())
        .get(`${base}/levels?low=true&locationId=${mainId}`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(lowElsewhere.body.total).toBe(0);
      const lowSearched = await request(app.getHttpServer())
        .get(`${base}/levels?low=true&search=stock`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(lowSearched.body.items).toHaveLength(1);

      // CSV exports mirror the reports and escape embedded commas and quotes.
      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: 1, reason: 'Cycle count, "aisle 3"' })
        .expect(201);
      const levelsExport = await request(app.getHttpServer())
        .get(`${base}/levels/export`)
        .set('Authorization', owner.auth)
        .expect(200)
        .expect('Content-Type', /text\/csv/)
        .expect('Content-Disposition', /attachment; filename="stock-levels\.csv"/);
      const levelLines = (levelsExport.text as string).trim().split('\r\n');
      expect(levelLines[0]).toBe('sku,product,location,quantity,unit,reorder_point,low,updated_at');
      expect(levelLines).toHaveLength(3);
      expect(levelLines[1]).toContain('STOCK-01,Stock Product,Main Warehouse,6,piece,4,false');
      expect(levelLines[2]).toContain('STOCK-01,Stock Product,Retail Store,4,piece,4,true');
      const movementsExport = await request(app.getHttpServer())
        .get(`${base}/movements/export?locationId=${storeId}`)
        .set('Authorization', owner.auth)
        .expect(200)
        .expect('Content-Type', /text\/csv/);
      const movementLines = (movementsExport.text as string).trim().split('\r\n');
      expect(movementLines).toHaveLength(2);
      expect(movementLines[1]).toContain('TRANSFER_IN,STOCK-01');
      const escaped = await request(app.getHttpServer())
        .get(`${base}/movements/export?locationId=${mainId}`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(escaped.text).toContain('"Cycle count, ""aisle 3"""');
    });
  }, 60000);

  it('rejects transfers and adjustments that would break the ledger', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app);
      const { base, productId, mainId, storeId, organizationId } = await seed(app, owner.auth);

      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: 5, reason: 'Opening balance' })
        .expect(201);

      const insufficient = await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', owner.auth)
        .send({ productId, fromLocationId: mainId, toLocationId: storeId, quantity: 6 })
        .expect(409);
      expect(insufficient.body.message).toBe('Only 5 available at the source location.');
      await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', owner.auth)
        .send({ productId, fromLocationId: storeId, toLocationId: mainId, quantity: 1 })
        .expect(409);
      await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', owner.auth)
        .send({ productId, fromLocationId: mainId, toLocationId: mainId, quantity: 1 })
        .expect(409);
      const overAdjust = await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: -6, reason: 'Stocktake' })
        .expect(409);
      expect(overAdjust.body.message).toBe('Only 5 available to adjust down.');
      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: 0, reason: 'Nothing' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: -1, reason: '   ' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', owner.auth)
        .send({
          productId: randomUUID(),
          fromLocationId: mainId,
          toLocationId: storeId,
          quantity: 1,
        })
        .expect(404);

      await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/locations/${storeId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      const archived = await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', owner.auth)
        .send({ productId, fromLocationId: mainId, toLocationId: storeId, quantity: 1 })
        .expect(409);
      expect(archived.body.message).toBe('The destination location is archived.');
      // Corrections at archived locations stay possible.
      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: storeId, quantity: 1, reason: 'Found during closure' })
        .expect(201);
    });
  }, 60000);

  it('separates read and write roles and isolates organizations', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const outsider = await registerVerified(app);
      const member = await registerVerified(app);
      const { base, productId, mainId, storeId, organizationId } = await seed(app, owner.auth);
      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', owner.auth)
        .send({ productId, locationId: mainId, quantity: 3, reason: 'Opening balance' })
        .expect(201);

      await request(app.getHttpServer()).get(`${base}/levels`).expect(401);
      await request(app.getHttpServer())
        .get(`${base}/levels`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer())
        .get(`${base}/levels/export`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', outsider.auth)
        .send({ productId, fromLocationId: mainId, toLocationId: storeId, quantity: 1 })
        .expect(404);

      const account = await database.user.findUniqueOrThrow({
        where: { email: member.email },
        select: { id: true },
      });
      const membership = await database.membership.create({
        data: { organizationId, userId: account.id, roles: ['PURCHASER'] },
      });
      await request(app.getHttpServer())
        .get(`${base}/levels`)
        .set('Authorization', member.auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', member.auth)
        .send({ productId, fromLocationId: mainId, toLocationId: storeId, quantity: 1 })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', member.auth)
        .send({ productId, locationId: mainId, quantity: 1, reason: 'Denied' })
        .expect(403);
      await database.membership.update({
        where: { id: membership.id },
        data: { roles: ['WAREHOUSE'] },
      });
      await request(app.getHttpServer())
        .post(`${base}/transfers`)
        .set('Authorization', member.auth)
        .send({ productId, fromLocationId: mainId, toLocationId: storeId, quantity: 1 })
        .expect(201);
    });
  }, 60000);

  it('serializes concurrent transfers of the same stock on committed data', async () => {
    outbox.length = 0;
    const app = await buildApp(prisma);
    const organizationIds: string[] = [];
    const userEmails: string[] = [];
    try {
      const email = `${randomUUID()}@example.test`;
      userEmails.push(email);
      const registered = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email, password, displayName: 'Concurrent Stock User' })
        .expect(201);
      const message = outbox.findLast((mail) => mail.to === email)!;
      const token = new URLSearchParams(new URL(message.actionUrl).hash.slice(1)).get('token')!;
      await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
      const auth = `Bearer ${registered.body.accessToken as string}`;
      const seedData = await seed(app, auth);
      organizationIds.push(seedData.organizationId);
      const { base, productId, mainId, storeId } = seedData;

      await request(app.getHttpServer())
        .post(`${base}/adjustments`)
        .set('Authorization', auth)
        .send({ productId, locationId: mainId, quantity: 10, reason: 'Opening balance' })
        .expect(201);

      const transfers = await Promise.all([
        request(app.getHttpServer())
          .post(`${base}/transfers`)
          .set('Authorization', auth)
          .send({ productId, fromLocationId: mainId, toLocationId: storeId, quantity: 10 }),
        request(app.getHttpServer())
          .post(`${base}/transfers`)
          .set('Authorization', auth)
          .send({ productId, fromLocationId: mainId, toLocationId: storeId, quantity: 10 }),
      ]);
      expect(transfers.map((response) => response.status).sort()).toEqual([201, 409]);
      const levels = await prisma.stockLevel.findMany({
        where: { organizationId: seedData.organizationId },
        select: { locationId: true, quantity: true },
      });
      expect(new Map(levels.map((level) => [level.locationId, level.quantity]))).toEqual(
        new Map([
          [mainId, 0],
          [storeId, 10],
        ]),
      );
      expect(
        await prisma.stockMovement.count({
          where: {
            organizationId: seedData.organizationId,
            type: { in: ['TRANSFER_IN', 'TRANSFER_OUT'] },
          },
        }),
      ).toBe(2);
    } finally {
      await prisma.stockMovement.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.stockTransfer.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.stockAdjustment.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.stockLevel.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.product.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.location.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await prisma.membership.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
      await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
      await app.close();
    }
  }, 60000);
});
