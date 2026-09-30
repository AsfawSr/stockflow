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

describe('Supplier and location APIs against PostgreSQL', () => {
  let prisma: PrismaService;
  const password = 'partner integration passphrase';
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
    const rollback = new Error('Rollback partner integration test');
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
                supplier: database.supplier,
                location: database.location,
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
      .send({ email, password, displayName: 'Partner Test User' })
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

  it('manages the supplier lifecycle with normalization, search, and conflicts', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth, 'Supplier Organization');
      const base = `/api/organizations/${organizationId}/suppliers`;

      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({
          name: ' Nile Electronics ',
          contactName: ' Sara Bekele ',
          email: ' SALES@NILE.TEST ',
          phone: ' +251 (11) 555-0100 ',
          address: '  ',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'Nile Electronics',
        contactName: 'Sara Bekele',
        email: 'sales@nile.test',
        phone: '+251 (11) 555-0100',
        address: null,
        archivedAt: null,
      });
      const supplierId = created.body.id as string;

      await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ name: 'Blue Cable Traders' })
        .expect(201);

      await database.$executeRaw`SAVEPOINT duplicate_supplier`;
      const duplicate = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ name: 'Nile Electronics' })
        .expect(409);
      await database.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_supplier`;
      expect(duplicate.body.message).toBe(
        'This supplier name is already used in this organization.',
      );

      const searched = await request(app.getHttpServer())
        .get(`${base}?search=nile`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(searched.body.total).toBe(1);
      expect(searched.body.items[0].id).toBe(supplierId);

      const updated = await request(app.getHttpServer())
        .patch(`${base}/${supplierId}`)
        .set('Authorization', owner.auth)
        .send({ phone: '', address: ' Bole Road 12 ' })
        .expect(200);
      expect(updated.body.phone).toBeNull();
      expect(updated.body.address).toBe('Bole Road 12');
      expect(updated.body.name).toBe('Nile Electronics');

      for (const body of [
        { name: '   ' },
        { email: 'not-an-email' },
        { phone: 'call me' },
        {},
        { organizationId: randomUUID(), name: 'Injected' },
      ]) {
        await request(app.getHttpServer())
          .patch(`${base}/${supplierId}`)
          .set('Authorization', owner.auth)
          .send(body)
          .expect(400);
      }

      await request(app.getHttpServer())
        .post(`${base}/${supplierId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer())
        .post(`${base}/${supplierId}/archive`)
        .set('Authorization', owner.auth)
        .expect(409);
      const active = await request(app.getHttpServer())
        .get(base)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(active.body.total).toBe(1);
      await request(app.getHttpServer())
        .post(`${base}/${supplierId}/restore`)
        .set('Authorization', owner.auth)
        .expect(200);
      await request(app.getHttpServer())
        .get(`${base}/${randomUUID()}`)
        .set('Authorization', owner.auth)
        .expect(404);
    });
  });

  it('manages the location lifecycle and rejects duplicates', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth, 'Location Organization');
      const base = `/api/organizations/${organizationId}/locations`;

      const created = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ name: ' Main Warehouse ', address: ' Industrial Zone 4 ' })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'Main Warehouse',
        address: 'Industrial Zone 4',
        archivedAt: null,
      });
      const locationId = created.body.id as string;

      await database.$executeRaw`SAVEPOINT duplicate_location`;
      const duplicate = await request(app.getHttpServer())
        .post(base)
        .set('Authorization', owner.auth)
        .send({ name: 'Main Warehouse' })
        .expect(409);
      await database.$executeRaw`ROLLBACK TO SAVEPOINT duplicate_location`;
      expect(duplicate.body.message).toBe(
        'This location name is already used in this organization.',
      );

      const updated = await request(app.getHttpServer())
        .patch(`${base}/${locationId}`)
        .set('Authorization', owner.auth)
        .send({ name: 'Central Warehouse', address: '' })
        .expect(200);
      expect(updated.body.name).toBe('Central Warehouse');
      expect(updated.body.address).toBeNull();

      await request(app.getHttpServer())
        .post(`${base}/${locationId}/archive`)
        .set('Authorization', owner.auth)
        .expect(200);
      const archived = await request(app.getHttpServer())
        .get(`${base}?status=archived`)
        .set('Authorization', owner.auth)
        .expect(200);
      expect(archived.body.items[0].id).toBe(locationId);
      await request(app.getHttpServer())
        .post(`${base}/${locationId}/restore`)
        .set('Authorization', owner.auth)
        .expect(200);
    });
  });

  it('enforces organization isolation and separate supplier and location roles', async () => {
    await withApplication(async (app, database) => {
      const owner = await registerVerified(app);
      const outsider = await registerVerified(app);
      const member = await registerVerified(app);
      const organizationId = await createOrganization(app, owner.auth, 'Role Organization');
      const suppliers = `/api/organizations/${organizationId}/suppliers`;
      const locations = `/api/organizations/${organizationId}/locations`;

      const supplier = await request(app.getHttpServer())
        .post(suppliers)
        .set('Authorization', owner.auth)
        .send({ name: 'Role Test Supplier' })
        .expect(201);
      const location = await request(app.getHttpServer())
        .post(locations)
        .set('Authorization', owner.auth)
        .send({ name: 'Role Test Warehouse' })
        .expect(201);

      for (const path of [suppliers, locations]) {
        await request(app.getHttpServer()).get(path).expect(401);
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', outsider.auth)
          .expect(404);
        await request(app.getHttpServer())
          .post(path)
          .set('Authorization', outsider.auth)
          .send({ name: 'Intruder' })
          .expect(404);
      }

      const memberAccount = await database.user.findUniqueOrThrow({
        where: { email: member.email },
        select: { id: true },
      });
      const membership = await database.membership.create({
        data: { organizationId, userId: memberAccount.id, roles: ['PURCHASER'] },
      });

      // A purchaser manages suppliers but only reads locations.
      await request(app.getHttpServer())
        .post(suppliers)
        .set('Authorization', member.auth)
        .send({ name: 'Purchaser Supplier' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`${suppliers}/${supplier.body.id}`)
        .set('Authorization', member.auth)
        .send({ contactName: 'Updated Contact' })
        .expect(200);
      const readable = await request(app.getHttpServer())
        .get(locations)
        .set('Authorization', member.auth)
        .expect(200);
      expect(readable.body.total).toBe(1);
      await request(app.getHttpServer())
        .post(locations)
        .set('Authorization', member.auth)
        .send({ name: 'Denied Warehouse' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${locations}/${location.body.id}/archive`)
        .set('Authorization', member.auth)
        .expect(403);

      await database.membership.update({
        where: { id: membership.id },
        data: { roles: ['MANAGER'] },
      });
      await request(app.getHttpServer())
        .post(suppliers)
        .set('Authorization', member.auth)
        .send({ name: 'Manager Supplier' })
        .expect(403);
      await request(app.getHttpServer())
        .post(locations)
        .set('Authorization', member.auth)
        .send({ name: 'Manager Warehouse' })
        .expect(403);
      await request(app.getHttpServer())
        .get(suppliers)
        .set('Authorization', member.auth)
        .expect(200);
    });
  });
});
