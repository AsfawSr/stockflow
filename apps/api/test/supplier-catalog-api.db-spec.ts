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

describe('Supplier catalog API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'supplier catalog integration passphrase';
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
    const rollback = new Error('Rollback supplier catalog integration test');
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

  async function registerVerified(app: INestApplication, displayName = 'Catalog Test User') {
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

  it('lists quoted prices by product name for members only', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Catalog Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Catalog ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const supplier = await authed('post', '/suppliers').send({ name: 'Catalog Supplier' });
      const supplierId = supplier.body.id as string;
      const zebra = await authed('post', '/products').send({
        sku: 'CAT-Z',
        name: 'Zebra Cable',
        unit: 'piece',
      });
      const anvil = await authed('post', '/products').send({
        sku: 'CAT-A',
        name: 'Anvil Adapter',
        unit: 'piece',
      });

      expect((await authed('get', `/suppliers/${supplierId}/catalog`).expect(200)).body).toEqual({
        items: [],
      });

      await database.supplierCatalogPrice.createMany({
        data: [
          {
            organizationId,
            supplierId,
            productId: zebra.body.id as string,
            unitPrice: '12.5',
          },
          {
            organizationId,
            supplierId,
            productId: anvil.body.id as string,
            unitPrice: '3',
          },
        ],
      });
      const list = await authed('get', `/suppliers/${supplierId}/catalog`).expect(200);
      expect(list.body.items).toHaveLength(2);
      expect(list.body.items[0]).toMatchObject({
        product: { sku: 'CAT-A', name: 'Anvil Adapter', unit: 'piece' },
        unitPrice: '3.00',
      });
      expect(list.body.items[1]).toMatchObject({
        product: { sku: 'CAT-Z' },
        unitPrice: '12.50',
      });
      expect(list.body.items[0].updatedAt).toBeTruthy();

      await authed('get', `/suppliers/${randomUUID()}/catalog`).expect(404);
      await authed('get', '/suppliers/not-a-uuid/catalog').expect(404);

      // Another organization's supplier is invisible, and its members see nothing here.
      const outsider = await registerVerified(app, 'Catalog Outsider');
      const other = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', outsider.auth)
        .send({ name: `Catalog Other ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      await request(app.getHttpServer())
        .get(`${api}/suppliers/${supplierId}/catalog`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/organizations/${other.body.id as string}/suppliers/${supplierId}/catalog`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer()).get(`${api}/suppliers/${supplierId}/catalog`).expect(401);
    });
  }, 60000);
});
