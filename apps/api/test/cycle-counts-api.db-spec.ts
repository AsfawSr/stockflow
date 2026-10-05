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
});
