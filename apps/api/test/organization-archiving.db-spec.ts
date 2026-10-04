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

describe('Organization archiving against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'organization archiving passphrase';
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
        invitation: transaction.invitation,
        product: transaction.product,
        supplier: transaction.supplier,
        location: transaction.location,
        purchaseOrder: transaction.purchaseOrder,
        purchaseOrderLine: transaction.purchaseOrderLine,
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
    const rollback = new Error('Rollback organization archiving test');
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

  async function registerVerified(app: INestApplication, displayName = 'Archive Test User') {
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
    database: Prisma.TransactionClient,
    app: INestApplication,
    organizationId: string,
    roles: string[],
  ) {
    const member = await registerVerified(app, 'Archive Member');
    const account = await database.user.findUniqueOrThrow({
      where: { email: member.email },
      select: { id: true },
    });
    await database.membership.create({
      data: { organizationId, userId: account.id, roles: roles as never },
    });
    return member;
  }

  it('archives an organization once and records who did it', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Archive ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      expect(organization.body.archivedAt).toBeNull();
      const archiveUrl = `/api/organizations/${organizationId}/archive`;

      const manager = await addMember(database, app, organizationId, ['MANAGER']);
      await request(app.getHttpServer())
        .post(archiveUrl)
        .set('Authorization', manager.auth)
        .expect(403);
      const outsider = await registerVerified(app);
      await request(app.getHttpServer())
        .post(archiveUrl)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer()).post(archiveUrl).expect(401);

      const archived = await request(app.getHttpServer())
        .post(archiveUrl)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(archived.body.archivedAt).not.toBeNull();

      // Reads keep working for members of an archived organization.
      const detail = await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(detail.body.archivedAt).toBe(archived.body.archivedAt);

      await request(app.getHttpServer())
        .post(archiveUrl)
        .set('Authorization', owner.auth)
        .expect(409);

      const audit = await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}/audit`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(audit.body.items[0]).toMatchObject({
        action: 'organization.archived',
        summary: 'Archived the organization',
      });
    });
  }, 60000);

  it('restores an archived organization and refuses to restore an active one', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `Restore ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const restoreUrl = `/api/organizations/${organizationId}/restore`;

      await request(app.getHttpServer())
        .post(restoreUrl)
        .set('Authorization', owner.auth)
        .expect(409);
      await request(app.getHttpServer())
        .post(`/api/organizations/${organizationId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);

      const manager = await addMember(database, app, organizationId, ['MANAGER']);
      await request(app.getHttpServer())
        .post(restoreUrl)
        .set('Authorization', manager.auth)
        .expect(403);
      const outsider = await registerVerified(app);
      await request(app.getHttpServer())
        .post(restoreUrl)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer()).post(restoreUrl).expect(401);

      const restored = await request(app.getHttpServer())
        .post(restoreUrl)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(restored.body.archivedAt).toBeNull();

      const audit = await request(app.getHttpServer())
        .get(`/api/organizations/${organizationId}/audit`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(audit.body.items.map((item: { action: string }) => item.action).slice(0, 2)).toEqual([
        'organization.restored',
        'organization.archived',
      ]);
    });
  }, 60000);

  it('keeps archived organizations readable but rejects every mutation', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const organization = await request(app.getHttpServer())
        .post('/api/organizations')
        .set('Authorization', owner.auth)
        .send({ name: `ReadOnly ${randomUUID().slice(0, 8)}`, currency: 'USD' })
        .expect(201);
      const organizationId = organization.body.id as string;
      const api = `/api/organizations/${organizationId}`;
      const authed = (method: 'get' | 'post' | 'patch', path: string) =>
        request(app.getHttpServer())[method](`${api}${path}`).set('Authorization', owner.auth);

      const product = await authed('post', '/products')
        .send({ sku: 'FROZEN-1', name: 'Frozen Widget', unit: 'piece' })
        .expect(201);
      await authed('post', '/suppliers').send({ name: 'Frozen Supplier' }).expect(201);
      await authed('post', '/locations').send({ name: 'Frozen Warehouse' }).expect(201);
      const invitee = await registerVerified(app, 'Frozen Invitee');
      await authed('post', '/invitations')
        .send({ email: invitee.email, roles: ['WAREHOUSE'] })
        .expect(201);
      const inviteMail = outbox.findLast((mail) => mail.to === invitee.email)!;
      const inviteToken = new URLSearchParams(new URL(inviteMail.actionUrl!).hash.slice(1)).get(
        'token',
      )!;
      await authed('post', '/archive').expect(200);

      // Reads across the workspace still answer.
      await authed('get', '/products').expect(200);
      await authed('get', '/suppliers').expect(200);
      await authed('get', '/stock/levels').expect(200);
      await authed('get', '/purchase-orders').expect(200);
      await authed('get', '/audit').expect(200);
      await authed('get', '/trends').expect(200);

      // Every mutating route answers 409, including pre-archive invitation links.
      await authed('post', '/products')
        .send({ sku: 'FROZEN-2', name: 'Another Widget', unit: 'piece' })
        .expect(409);
      await authed('patch', `/products/${product.body.id}`).send({ name: 'Renamed' }).expect(409);
      await authed('patch', '').send({ name: 'Renamed Org' }).expect(409);
      await authed('post', '/suppliers').send({ name: 'Blocked Supplier' }).expect(409);
      await authed('post', '/purchase-orders')
        .send({ supplierId: randomUUID(), locationId: randomUUID() })
        .expect(409);
      await authed('post', '/stock/adjustments')
        .send({
          productId: product.body.id,
          locationId: randomUUID(),
          quantity: 1,
          reason: 'Blocked',
        })
        .expect(409);
      await authed('post', '/invitations')
        .send({ email: `${randomUUID()}@example.test`, roles: ['MANAGER'] })
        .expect(409);
      const blockedAccept = await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', invitee.auth)
        .send({ token: inviteToken })
        .expect(409);
      expect(blockedAccept.body.message).toContain('archived');

      // Restoring reopens the workspace for writes.
      await authed('post', '/restore').expect(200);
      await authed('post', '/products')
        .send({ sku: 'FROZEN-2', name: 'Another Widget', unit: 'piece' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/invitations/accept')
        .set('Authorization', invitee.auth)
        .send({ token: inviteToken })
        .expect(200);
      expect(database).toBeDefined();
    });
  }, 60000);
});
