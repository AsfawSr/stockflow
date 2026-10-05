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

describe('Organization export API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'organization export integration passphrase';
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
    const rollback = new Error('Rollback organization export integration test');
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

  async function registerVerified(app: INestApplication, displayName = 'Export Test User') {
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

  it('describes itself and the organization profile', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app, 'Export Owner');
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Export ${randomUUID().slice(0, 8)}`, currency: 'ETB' })
        .expect(201);
      const organizationId = organization.body.id as string;

      const exported = await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}/export`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(exported.body.format).toBe('stockflow-export');
      expect(exported.body.version).toBe(1);
      expect(new Date(exported.body.exportedAt).getTime()).not.toBeNaN();
      expect(exported.body.organization).toMatchObject({
        id: organizationId,
        name: organization.body.name,
        currency: 'ETB',
        replyToEmail: null,
        archivedAt: null,
      });
      expect(exported.body.organization.createdAt).toBeTruthy();

      const audit = await database.auditEvent.findMany({
        where: { organizationId, action: 'organization.exported' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].summary).toBe(`Exported the organization's data`);
      expect(audit[0].entityId).toBe(organizationId);
    });
  }, 60000);
});
