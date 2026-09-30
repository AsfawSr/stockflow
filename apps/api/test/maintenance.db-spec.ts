import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { CleanupService } from '../src/maintenance/cleanup.service';
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
      const result = await service.sweep();
      expect(result).not.toBeNull();
      expect(result!.sessions).toBeGreaterThanOrEqual(1);
      expect(result!.tokens).toBeGreaterThanOrEqual(1);
      expect(result!.invitations).toBeGreaterThanOrEqual(1);

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
});
