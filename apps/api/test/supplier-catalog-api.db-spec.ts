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

  it('quotes and requotes products with role and state guards', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Catalog Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Catalog ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'put', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const supplier = await authed('post', '/suppliers').send({ name: 'Quoting Supplier' });
      const supplierId = supplier.body.id as string;
      const product = await authed('post', '/products').send({
        sku: 'QUOTE-1',
        name: 'Quoted Widget',
        unit: 'piece',
      });
      const productId = product.body.id as string;
      const entryPath = `/suppliers/${supplierId}/catalog/${productId}`;

      const created = await authed('put', entryPath).send({ unitPrice: '12.50' }).expect(200);
      expect(created.body).toMatchObject({
        product: { id: productId, sku: 'QUOTE-1' },
        unitPrice: '12.50',
      });

      // Requoting updates the same entry instead of adding a second one.
      const requoted = await authed('put', entryPath).send({ unitPrice: '11' }).expect(200);
      expect(requoted.body.id).toBe(created.body.id);
      expect(requoted.body.unitPrice).toBe('11.00');
      const list = await authed('get', `/suppliers/${supplierId}/catalog`).expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].unitPrice).toBe('11.00');

      await authed('put', entryPath).send({ unitPrice: 'twelve' }).expect(400);
      await authed('put', entryPath).send({ unitPrice: '-5' }).expect(400);
      await authed('put', entryPath).send({ unitPrice: '0' }).expect(400);
      await authed('put', entryPath).send({ unitPrice: '0.00' }).expect(400);
      await authed('put', `/suppliers/${randomUUID()}/catalog/${productId}`)
        .send({ unitPrice: '5.00' })
        .expect(404);
      await authed('put', `/suppliers/${supplierId}/catalog/${randomUUID()}`)
        .send({ unitPrice: '5.00' })
        .expect(404);

      // Archived products cannot be quoted.
      await authed('post', `/products/${productId}/archive`).expect(200);
      await authed('put', entryPath).send({ unitPrice: '5.00' }).expect(409);
      await authed('post', `/products/${productId}/restore`).expect(200);

      // Warehouse members manage stock, not supplier terms.
      const warehouse = await addMember(
        app,
        owner.auth,
        organizationId,
        ['WAREHOUSE'],
        'Catalog Warehouse',
      );
      await request(app.getHttpServer())
        .put(`${api}${entryPath}`)
        .set('Authorization', warehouse.auth)
        .send({ unitPrice: '5.00' })
        .expect(403);

      const audit = await database.auditEvent.findMany({
        where: { organizationId, action: 'supplier.price_set' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit).toHaveLength(2);
      expect(audit[0].summary).toBe('Quoted Quoted Widget at 12.50 for Quoting Supplier');
      expect(audit[0].entityId).toBe(supplierId);

      // Archived organizations reject quoting like every other change.
      await authed('post', '/archive').expect(200);
      await authed('put', entryPath).send({ unitPrice: '6.00' }).expect(423);
    });
  }, 60000);

  it('removes quotes without touching order history', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Catalog Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Catalog ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const supplier = await authed('post', '/suppliers').send({ name: 'Removal Supplier' });
      const supplierId = supplier.body.id as string;
      const product = await authed('post', '/products').send({
        sku: 'REMOVE-1',
        name: 'Removable Widget',
        unit: 'piece',
      });
      const productId = product.body.id as string;
      const entryPath = `/suppliers/${supplierId}/catalog/${productId}`;

      await authed('put', entryPath).send({ unitPrice: '4.25' }).expect(200);
      await authed('delete', entryPath).expect(204);
      expect(
        (await authed('get', `/suppliers/${supplierId}/catalog`).expect(200)).body.items,
      ).toEqual([]);
      await authed('delete', entryPath).expect(404);
      await authed('delete', `/suppliers/${randomUUID()}/catalog/${productId}`).expect(404);

      const audit = await database.auditEvent.findMany({
        where: { organizationId, action: 'supplier.price_removed' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].summary).toBe('Removed the Removable Widget quote for Removal Supplier');
    });
  }, 60000);
});
