import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CleanupService } from '../src/maintenance/cleanup.service';
import { PostgresThrottlerStorage } from '../src/maintenance/postgres-throttler.storage';
import { PrismaService } from '../src/prisma/prisma.service';

const hash = () => createHash('sha256').update(randomUUID()).digest('hex');
const HOUR = 60 * 60 * 1000;

describe('Expired record cleanup against PostgreSQL', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    config({ quiet: true });
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('removes only expired sessions, account tokens, and invitations', async () => {
    const email = `${randomUUID()}@example.test`;
    let organizationId: string | undefined;
    let userId: string | undefined;
    try {
      const user = await prisma.user.create({
        data: { email, displayName: 'Cleanup Test User' },
        select: { id: true },
      });
      userId = user.id;
      const organization = await prisma.organization.create({
        data: { name: `Cleanup ${randomUUID().slice(0, 8)}`, currency: 'USD' },
        select: { id: true },
      });
      organizationId = organization.id;
      const now = Date.now();
      const [expiredSession, liveSession] = await Promise.all([
        prisma.session.create({
          data: {
            userId: user.id,
            tokenHash: hash(),
            createdAt: new Date(now - 2 * HOUR),
            expiresAt: new Date(now - HOUR),
          },
          select: { id: true },
        }),
        prisma.session.create({
          data: { userId: user.id, tokenHash: hash(), expiresAt: new Date(now + HOUR) },
          select: { id: true },
        }),
      ]);
      const expiredToken = await prisma.accountToken.create({
        data: {
          userId: user.id,
          email,
          purpose: 'VERIFY_EMAIL',
          tokenHash: hash(),
          authVersion: 0,
          createdAt: new Date(now - 2 * HOUR),
          expiresAt: new Date(now - HOUR),
        },
        select: { id: true },
      });
      const [expiredInvitation, liveInvitation] = await Promise.all([
        prisma.invitation.create({
          data: {
            organizationId: organization.id,
            email: `${randomUUID()}@example.test`,
            roles: ['MANAGER'],
            tokenHash: hash(),
            invitedById: user.id,
            createdAt: new Date(now - 2 * HOUR),
            expiresAt: new Date(now - HOUR),
          },
          select: { id: true },
        }),
        prisma.invitation.create({
          data: {
            organizationId: organization.id,
            email: `${randomUUID()}@example.test`,
            roles: ['MANAGER'],
            tokenHash: hash(),
            invitedById: user.id,
            expiresAt: new Date(now + HOUR),
          },
          select: { id: true },
        }),
      ]);

      const service = new CleanupService(prisma, new ConfigService({ NODE_ENV: 'test' }));
      const expiredLimitKey = `test:${randomUUID()}`;
      const liveLimitKey = `test:${randomUUID()}`;
      await prisma.rateLimit.createMany({
        data: [
          { key: expiredLimitKey, hits: 7, expiresAt: new Date(now - HOUR) },
          { key: liveLimitKey, hits: 3, expiresAt: new Date(now + HOUR) },
        ],
      });
      const result = await service.sweep();
      expect(result).not.toBeNull();
      expect(result!.sessions).toBeGreaterThanOrEqual(1);
      expect(result!.tokens).toBeGreaterThanOrEqual(1);
      expect(result!.invitations).toBeGreaterThanOrEqual(1);
      expect(result!.rateLimits).toBeGreaterThanOrEqual(1);

      expect(await prisma.rateLimit.findUnique({ where: { key: expiredLimitKey } })).toBeNull();
      expect(await prisma.rateLimit.findUnique({ where: { key: liveLimitKey } })).not.toBeNull();
      await prisma.rateLimit.deleteMany({ where: { key: liveLimitKey } });
      expect(await prisma.session.findUnique({ where: { id: expiredSession.id } })).toBeNull();
      expect(await prisma.session.findUnique({ where: { id: liveSession.id } })).not.toBeNull();
      expect(await prisma.accountToken.findUnique({ where: { id: expiredToken.id } })).toBeNull();
      expect(
        await prisma.invitation.findUnique({ where: { id: expiredInvitation.id } }),
      ).toBeNull();
      expect(
        await prisma.invitation.findUnique({ where: { id: liveInvitation.id } }),
      ).not.toBeNull();
    } finally {
      if (organizationId) await prisma.invitation.deleteMany({ where: { organizationId } });
      if (userId) {
        await prisma.session.deleteMany({ where: { userId } });
        await prisma.accountToken.deleteMany({ where: { userId } });
      }
      if (organizationId) await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { email } });
    }
  }, 30000);

  it('counts shared rate-limit windows atomically and resets after expiry', async () => {
    const storage = new PostgresThrottlerStorage(prisma);
    const key = randomUUID();
    const otherKey = randomUUID();
    try {
      const first = await storage.increment(key, 60000, 3, 0, 'default');
      expect(first).toMatchObject({ totalHits: 1, isBlocked: false, timeToBlockExpire: 0 });
      expect(first.timeToExpire).toBeGreaterThanOrEqual(1);
      expect(first.timeToExpire).toBeLessThanOrEqual(60);

      // Parallel hits across "processes" never lose a count.
      const burst = await Promise.all(
        Array.from({ length: 5 }, () => storage.increment(key, 60000, 3, 0, 'default')),
      );
      const totals = burst.map((record) => record.totalHits).sort((a, b) => a - b);
      expect(totals).toEqual([2, 3, 4, 5, 6]);
      expect(burst.filter((record) => record.isBlocked)).toHaveLength(3);
      const blocked = burst.find((record) => record.totalHits === 6)!;
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.timeToBlockExpire).toBeGreaterThanOrEqual(1);

      // Separate throttler names and keys count independently.
      const named = await storage.increment(key, 60000, 3, 0, 'login');
      expect(named.totalHits).toBe(1);
      const other = await storage.increment(otherKey, 60000, 3, 0, 'default');
      expect(other.totalHits).toBe(1);

      // A finished window restarts from one.
      await prisma.rateLimit.updateMany({
        where: { key: `default:${key}` },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const reset = await storage.increment(key, 60000, 3, 0, 'default');
      expect(reset).toMatchObject({ totalHits: 1, isBlocked: false });
    } finally {
      await prisma.rateLimit.deleteMany({
        where: { key: { in: [`default:${key}`, `login:${key}`, `default:${otherKey}`] } },
      });
    }
  }, 30000);

  it('throttles through PostgreSQL when RATE_LIMIT_STORE=database', async () => {
    process.env.RATE_LIMIT_STORE = 'database';
    let app: import('@nestjs/common').INestApplication | undefined;
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
      const attempt = () =>
        request(app!.getHttpServer())
          .post('/api/auth/login')
          .send({ email: `${randomUUID()}@example.test`, password: 'definitely incorrect' });
      const responses = [];
      for (let index = 0; index < 6; index += 1) responses.push((await attempt()).status);
      // Login allows five attempts per minute; the sixth must hit the shared counter.
      expect(responses.slice(0, 5).every((status) => status === 401)).toBe(true);
      expect(responses[5]).toBe(429);
      expect(
        await prisma.rateLimit.count({ where: { expiresAt: { gt: new Date() } } }),
      ).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.RATE_LIMIT_STORE;
      await prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'default:' } } });
      await app?.close();
    }
  }, 60000);
});
