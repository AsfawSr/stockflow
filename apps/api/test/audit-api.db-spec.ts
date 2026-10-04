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

describe('Audit log API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'audit log integration passphrase';
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
    const rollback = new Error('Rollback audit integration test');
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

  async function registerVerified(app: INestApplication, displayName = 'Audit Test User') {
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

  it('records workspace activity and serves it to administrators only', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app, 'Audit Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Audit ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const supplier = await authed('post', '/suppliers').send({ name: 'Audit Supplier' });
      const location = await authed('post', '/locations').send({ name: 'Audit Warehouse' });
      const second = await authed('post', '/locations').send({ name: 'Audit Shelf' });
      const product = await authed('post', '/products').send({
        sku: 'AUDIT-1',
        name: 'Audited Widget',
        unit: 'piece',
      });

      // Order lifecycle: created, submitted, approved, received.
      const order = await authed('post', '/purchase-orders')
        .send({ supplierId: supplier.body.id, locationId: location.body.id })
        .expect(201);
      const orderId = order.body.id as string;
      const line = await authed('post', `/purchase-orders/${orderId}/lines`)
        .send({ productId: product.body.id, quantity: 5, unitPrice: '3.00' })
        .expect(201);
      await authed('post', `/purchase-orders/${orderId}/submit`).expect(200);
      await authed('post', `/purchase-orders/${orderId}/approve`).send({}).expect(200);
      await authed('post', `/purchase-orders/${orderId}/receipts`)
        .send({ lines: [{ purchaseOrderLineId: line.body.lines[0].id, quantity: 5 }] })
        .expect(201);

      // Hand-entered stock movements.
      await authed('post', '/stock/transfers')
        .send({
          productId: product.body.id,
          fromLocationId: location.body.id,
          toLocationId: second.body.id,
          quantity: 2,
        })
        .expect(201);
      await authed('post', '/stock/adjustments')
        .send({
          productId: product.body.id,
          locationId: second.body.id,
          quantity: -1,
          reason: 'Damaged',
        })
        .expect(201);

      // Invitations and membership management.
      const member = await registerVerified(app, 'Audit Member');
      const revoked = await authed('post', '/invitations')
        .send({ email: member.email, roles: ['WAREHOUSE'] })
        .expect(201);
      await authed('delete', `/invitations/${revoked.body.id}`).expect(204);
      await authed('post', '/invitations')
        .send({ email: member.email, roles: ['WAREHOUSE'] })
        .expect(201);
      const inviteMail = outbox.findLast((mail) => mail.to === member.email)!;
      const inviteToken = new URLSearchParams(new URL(inviteMail.actionUrl!).hash.slice(1)).get(
        'token',
      )!;
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', member.auth)
        .send({ token: inviteToken })
        .expect(200);
      const memberId = (
        await request(app.getHttpServer())
          .get('/api/auth/me')
          .set('Authorization', member.auth)
          .expect(200)
      ).body.id as string;
      await authed('patch', `/members/${memberId}`)
        .send({ roles: ['MANAGER'] })
        .expect(200);
      await authed('delete', `/members/${memberId}`).expect(204);

      const list = await authed('get', '/audit').expect(200);
      expect(list.body.total).toBe(12);
      expect(list.body.items.map((item: { summary: string }) => item.summary)).toEqual([
        `Removed ${member.email} from the organization`,
        `Changed roles for ${member.email} to MANAGER`,
        `${member.email} joined from an invitation`,
        `Invited ${member.email} as WAREHOUSE`,
        `Revoked the invitation for ${member.email}`,
        `Invited ${member.email} as WAREHOUSE`,
        'Adjusted Audited Widget by -1 piece at Audit Shelf (Damaged)',
        'Transferred 2 piece Audited Widget from Audit Warehouse to Audit Shelf',
        'Received 5 units for purchase order PO-0001',
        'Approved purchase order PO-0001',
        'Submitted purchase order PO-0001',
        'Created purchase order PO-0001',
      ]);
      const approval = list.body.items[9];
      expect(approval.action).toBe('order.approved');
      expect(approval.entityType).toBe('purchase_order');
      expect(approval.entityId).toBe(orderId);
      expect(approval.actor).toEqual({ id: expect.any(String), displayName: 'Audit Owner' });
      expect(approval.createdAt).toBeTruthy();

      const paged = await authed('get', '/audit?page=2&pageSize=5').expect(200);
      expect(paged.body.items).toHaveLength(5);
      expect(paged.body.total).toBe(12);
      expect(paged.body.items[0].summary).toBe(`Invited ${member.email} as WAREHOUSE`);

      // Admin-only reads: non-admin members, outsiders, and anonymous callers see nothing.
      const helper = await registerVerified(app, 'Audit Helper');
      await authed('post', '/invitations')
        .send({ email: helper.email, roles: ['PURCHASER'] })
        .expect(201);
      const helperMail = outbox.findLast((mail) => mail.to === helper.email)!;
      const helperToken = new URLSearchParams(new URL(helperMail.actionUrl!).hash.slice(1)).get(
        'token',
      )!;
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', helper.auth)
        .send({ token: helperToken })
        .expect(200);
      await request(app.getHttpServer())
        .get(`${api}/audit`)
        .set('Authorization', helper.auth)
        .expect(403);
      const outsider = await registerVerified(app, 'Audit Outsider');
      await request(app.getHttpServer())
        .get(`${api}/audit`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer()).get(`${api}/audit`).expect(401);

      // Another organization's log stays isolated.
      const other = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', outsider.auth)
        .send({ name: `Audit Other ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const otherList = await request(app.getHttpServer())
        .get(`/api/organizations/${other.body.id}/audit`)
        .set('Authorization', outsider.auth)
        .expect(200);
      expect(otherList.body.items).toEqual([]);
    });
  }, 60000);
});
