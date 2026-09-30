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

describe('Product API against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'product integration passphrase';
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

  async function withApplication(
    run: (app: INestApplication, database: Prisma.TransactionClient) => Promise<void>,
  ) {
    outbox.length = 0;
    const rollback = new Error('Rollback product integration test');
    let app: INestApplication | undefined;
    try {
      await expect(
        prisma.$transaction(
          async (database) => {
            const module = await Test.createTestingModule({ imports: [AppModule] })
              .overrideProvider(PrismaService)
              .useValue({
                user: database.user,
                session: database.session,
                organization: database.organization,
                membership: database.membership,
                accountToken: database.accountToken,
                product: database.product,
                $transaction: (
                  callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
                ) => callback(database),
                $queryRaw: database.$queryRaw.bind(database),
              })
              .overrideProvider(AccountMailer)
              .useValue({
                webOrigin: 'http://127.0.0.1:3000',
                send: async (mail: AccountEmail) => {
                  outbox.push(mail);
                },
              })
              .compile();
            app = module.createNestApplication();
            app.setGlobalPrefix('api');
            await app.init();
            await run(app, database);
            throw rollback;
          },
          { timeout: 30000 },
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
      .send({ email, password, displayName: 'Product Test User' })
      .expect(201);
    const message = outbox.findLast((mail) => mail.to === email);
    if (!message) throw new Error('Verification email was not captured.');
    const token = new URLSearchParams(new URL(message.actionUrl).hash.slice(1)).get('token')!;
    await request(app.getHttpServer()).post('/api/auth/email/verify').send({ token }).expect(200);
    return { auth: `Bearer ${response.body.accessToken as string}`, email };
  }

  async function createOrganization(app: INestApplication, auth: string, name: string) {
    const response = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', auth)
      .send({ name, currency: 'USD' })
      .expect(201);
    return response.body.id as string;
  }

  it('creates, lists, filters, updates, archives, and restores products within the caller organization', async () => {
    await withApplication(async (app) => {
      const owner = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth, 'Catalog Organization');
      const base = `/api/organizations/${organizationId}/products`;

      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ sku: ' usb-c_65w.01 ', name: ' USB-C Charger ', unit: ' piece ' })
        .expect(201);
      expect(created.body).toMatchObject({
        sku: 'USB-C_65W.01',
        name: 'USB-C Charger',
        unit: 'piece',
        description: null,
        archivedAt: null,
      });
      const productId = created.body.id as string;

      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ sku: 'CABLE-01', name: 'HDMI Cable', unit: 'piece', description: '  ' })
        .expect(201);

      const listed = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(listed.body.total).toBe(2);
      expect(listed.body.items.map((item: { sku: string }) => item.sku)).toEqual([
        'CABLE-01',
        'USB-C_65W.01',
      ]);

      const searched = await request(app.getHttpServer())
        .get(`${base}?search=usb-c_65`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(searched.body.items).toHaveLength(1);
      expect(searched.body.items[0].id).toBe(productId);

      const paged = await request(app.getHttpServer())
        .get(`${base}?page=2&pageSize=1`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(paged.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(paged.body.items[0].id).toBe(productId);

      const updated = await request(app.getHttpServer())
        .patch(`${base}/${productId}`)
        .set('Authorization', owner.auth)
        .send({ name: 'USB-C Charger 65W', description: ' Fast charger ' })
        .expect(200);
      expect(updated.body.name).toBe('USB-C Charger 65W');
      expect(updated.body.description).toBe('Fast charger');
      expect(updated.body.sku).toBe('USB-C_65W.01');

      const archived = await request(app.getHttpServer())
        .post(`${base}/${productId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(archived.body.archivedAt).not.toBeNull();
      await request(app.getHttpServer())
        .post(`${base}/${productId}/archive`)
        .set('Authorization', owner.auth)
        .expect(409);

      const activeOnly = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(activeOnly.body.total).toBe(1);
      const archivedList = await request(app.getHttpServer())
        .get(`${base}?status=archived`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(archivedList.body.items[0].id).toBe(productId);
      const everything = await request(app.getHttpServer())
        .get(`${base}?status=all`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(everything.body.total).toBe(2);

      const restored = await request(app.getHttpServer())
        .post(`${base}/${productId}/restore`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(restored.body.archivedAt).toBeNull();
      expect(restored.body.id).toBe(productId);
      await request(app.getHttpServer())
        .post(`${base}/${productId}/restore`)
        .set('Authorization', owner.auth)
        .expect(409);
    });
  });

  it('rejects duplicate SKUs, invalid input, and unknown products with safe errors', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth, 'Validation Organization');
      const base = `/api/organizations/${organizationId}/products`;

      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ sku: 'DUP-01', name: 'First', unit: 'piece' })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ sku: 'OTHER-01', name: 'Second', unit: 'piece' })
        .expect(201);

      await database.$executeRaw`SAVEPOINT duplicate_sku`;
      const duplicate = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ sku: 'dup-01', name: 'Duplicate', unit: 'piece' })
        .expect(409);
      await database.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_sku`;
      expect(duplicate.body.message).toBe('This SKU is already used in this organization.');

      await database.$executeRaw`SAVEPOINT duplicate_sku_update`;
      await request(app.getHttpServer())
        .patch(`${base}/${second.body.id}`)
        .set('Authorization', owner.auth)
        .send({ sku: 'DUP-01' })
        .expect(409);
      await database.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_sku_update`;

      for (const body of [
        { sku: 'SKU 01', name: 'Broken', unit: 'piece' },
        { sku: 'SKU-01', name: '   ', unit: 'piece' },
        { sku: 'SKU-01', name: 'No Unit', unit: ' ' },
        { sku: 'SKU-01', name: 'Extra', unit: 'piece', archivedAt: null },
        { sku: 'SKU-01', name: 'Extra', unit: 'piece', organizationId: randomUUID() },
      ]) {
        await request(app.getHttpServer())
          .post(base)
          .set('Authorization', owner.auth)
          .send(body)
          .expect(400);
      }
      await request(app.getHttpServer())
        .patch(`${base}/${second.body.id}`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(400);
      await request(app.getHttpServer())
        .get(`${base}?pageSize=1000`)
        .set('Authorization', owner.auth)
        .expect(400);

      await request(app.getHttpServer())
        .get(`${base}/${randomUUID()}`)
        .set('Authorization', owner.auth)
        .expect(404);
      await request(app.getHttpServer())
        .get(`${base}/not-a-uuid`)
        .set('Authorization', owner.auth)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`${base}/${randomUUID()}`)
        .set('Authorization', owner.auth)
        .send({ name: 'Ghost' })
        .expect(404);
      await request(app.getHttpServer())
        .post(`${base}/${randomUUID()}/archive`)
        .set('Authorization', owner.auth)
        .expect(404);
    });
  });

  it('enforces organization isolation and catalog management roles', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const outsider = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth, 'Isolated Organization');
      const outsiderOrganization = await createOrganization(
        app,
        outsider.auth,
        'Outsider Organization',
      );
      const base = `/api/organizations/${organizationId}/products`;

      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ sku: 'SECRET-01', name: 'Private Product', unit: 'piece' })
        .expect(201);
      const productId = created.body.id as string;

      await request(app.getHttpServer()).get(base).expect(401);
      await request(app.getHttpServer()).get(base).set('Authorization', outsider.auth).expect(404);
      await request(app.getHttpServer())
        .get(`${base}/${productId}`)
        .set('Authorization', outsider.auth)
        .expect(404);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', outsider.auth)
        .send({ sku: 'INTRUDER-01', name: 'Intruder', unit: 'piece' })
        .expect(404);

      // The same SKU may exist in another organization.
      await request(app.getHttpServer())
        .post(`/api/organizations/${outsiderOrganization}/products`)
        .set('Authorization', outsider.auth)
        .send({ sku: 'SECRET-01', name: 'Unrelated Product', unit: 'piece' })
        .expect(201);

      // A product id from another organization is not addressable here.
      await request(app.getHttpServer())
        .patch(`/api/organizations/${outsiderOrganization}/products/${productId}`)
        .set('Authorization', outsider.auth)
        .send({ name: 'Hijacked' })
        .expect(404);

      const member = await registerVerified(app);
      const memberAccount = await database.user.findUniqueOrThrow({
        where: { email: member.email },
        select: { id: true },
      });
      const membership = await database.membership.create({
        data: { organizationId, userId: memberAccount.id, roles: ['WAREHOUSE'] },
      });

      const memberList = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', member.auth)
        .expect(200);
      expect(memberList.body.total).toBe(1);
      await request(app.getHttpServer())
        .get(`${base}/${productId}`)
        .set('Authorization', member.auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', member.auth)
        .send({ sku: 'DENIED-01', name: 'Denied', unit: 'piece' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`${base}/${productId}`)
        .set('Authorization', member.auth)
        .send({ name: 'Denied Rename' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${base}/${productId}/archive`)
        .set('Authorization', member.auth)
        .expect(403);

      await database.membership.update({
        where: { id: membership.id },
        data: { roles: ['MANAGER'] },
      });
      await request(app.getHttpServer())
        .post(`${base}/${productId}/archive`)
        .set('Authorization', member.auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${productId}/restore`)
        .set('Authorization', member.auth)
        .expect(200);
    });
  });
});
